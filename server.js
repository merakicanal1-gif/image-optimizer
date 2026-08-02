const express = require('express');
const multer = require('multer');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware CORS nativo
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Suporte opcional a requisições JSON (para imagem em Base64)
app.use(express.json({ limit: '20mb' }));

// Configuração do Multer para multipart/form-data
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // Limite de 20 MB
}).single('image');

// Configuração do parser raw para application/octet-stream
const rawParser = express.raw({
  type: 'application/octet-stream',
  limit: '20mb'
});

// Definição dos presets da API
const PRESETS = {
  whatsapp: {
    format: 'jpeg',
    width: 1080,
    quality: 78,
    fit: 'inside',
    stripMetadata: true
  },
  telegram: {
    format: 'jpeg',
    width: 1280,
    quality: 82,
    fit: 'inside',
    stripMetadata: true
  },
  thumbnail: {
    format: 'png',
    width: 200,
    height: 200,
    fit: 'cover',
    stripMetadata: true
  }
};

// Definição das estratégias de otimização originais (Compatibilidade para modo sem parâmetros)
const strategies = [
  {
    name: 'palette=false',
    execute: (instance, params) => instance.clone().png({
      compressionLevel: params.compressionLevel,
      palette: false,
      effort: 10,
      adaptiveFiltering: true
    }).toBuffer()
  },
  {
    name: 'palette=true',
    execute: (instance, params) => instance.clone().png({
      compressionLevel: params.compressionLevel,
      palette: true,
      quality: params.quality,
      effort: 10,
      adaptiveFiltering: true
    }).toBuffer()
  }
];

// Helper para obter qualidade mínima por formato
const getMinQuality = (format) => {
  if (format === 'jpeg') return 55;
  if (format === 'webp') return 60;
  return 0; // PNG não possui limite artificial de qualidade
};

// Helper unificado para executar a compressão via Sharp
async function compressImage(sharpInstance, format, quality, scale, options) {
  let pipeline = sharpInstance.clone();

  // 1. Redimensionamento
  const targetWidth = options.width ? Math.round(options.width * scale) : null;
  const targetHeight = options.height ? Math.round(options.height * scale) : null;

  if (targetWidth || targetHeight) {
    pipeline = pipeline.resize({
      width: targetWidth || undefined,
      height: targetHeight || undefined,
      fit: options.fit || 'inside',
      withoutEnlargement: true
    });
  } else if (scale < 1.0 && (options.originalWidth || options.originalHeight)) {
    pipeline = pipeline.resize({
      width: options.originalWidth ? Math.round(options.originalWidth * scale) : undefined,
      height: options.originalHeight ? Math.round(options.originalHeight * scale) : undefined,
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  // 2. Metadados
  if (!options.stripMetadata) {
    pipeline = pipeline.withMetadata();
  }

  // 3. Opções específicas de formato
  let formatOptions = { quality };
  if (format === 'png') {
    formatOptions = {
      quality,
      palette: true,
      compressionLevel: 9,
      effort: 10,
      adaptiveFiltering: true
    };
  } else if (format === 'jpeg') {
    formatOptions = { quality, mozjpeg: true };
  } else if (format === 'webp') {
    formatOptions = { quality, effort: 6 };
  }

  return pipeline.toFormat(format, formatOptions).toBuffer();
}

// Helper para formatar o tamanho dos arquivos nos logs
const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

// Rota GET /health
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    version: '1.2.0',
    uptime: Math.floor(process.uptime()),
    node: process.version
  });
});

// Rota GET /info
app.get('/info', (req, res) => {
  res.json({
    service: 'image-optimizer',
    version: '1.2.0',
    node: process.version,
    sharp: sharp.versions.sharp
  });
});

// Middleware unificado para recepção de imagem
app.post('/optimize', (req, res, next) => {
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('multipart/form-data')) {
    upload(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            success: false,
            error: 'O arquivo excede o limite máximo de 20 MB.'
          });
        }
        return res.status(400).json({
          success: false,
          error: err.message
        });
      }
      next();
    });
  } else if (contentType.includes('application/octet-stream')) {
    rawParser(req, res, (err) => {
      if (err) {
        if (err.status === 413) {
          return res.status(413).json({
            success: false,
            error: 'O arquivo excede o limite máximo de 20 MB.'
          });
        }
        return res.status(400).json({
          success: false,
          error: err.message
        });
      }
      next();
    });
  } else if (contentType.includes('application/json')) {
    next();
  } else {
    return res.status(400).json({
      success: false,
      error: 'Content-Type inválido. Use multipart/form-data, application/octet-stream ou application/json.'
    });
  }
}, async (req, res) => {
  const startTime = Date.now();

  // 1. Extração do Buffer de Imagem
  let imageBuffer = null;
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('multipart/form-data') && req.file) {
    imageBuffer = req.file.buffer;
  } else if (contentType.includes('application/octet-stream') && Buffer.isBuffer(req.body)) {
    imageBuffer = req.body;
  } else if (contentType.includes('application/json') && req.body && req.body.image) {
    let base64Data = req.body.image;
    if (base64Data.includes(',')) {
      base64Data = base64Data.split(',')[1];
    }
    imageBuffer = Buffer.from(base64Data, 'base64');
  }

  if (!imageBuffer || imageBuffer.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Arquivo de imagem não enviado.'
    });
  }

  // 2. Parâmetros da Requisição (Query + Body)
  const queryAndBody = { ...req.query, ...req.body };

  const isDefaultBehavior = !queryAndBody.preset &&
                            !queryAndBody.format &&
                            !queryAndBody.quality &&
                            !queryAndBody.width &&
                            !queryAndBody.height &&
                            !queryAndBody.fit &&
                            !queryAndBody.stripMetadata &&
                            !queryAndBody.targetSizeKB;

  try {
    const sharpInstance = sharp(imageBuffer);
    const metadata = await sharpInstance.metadata();
    const originalFormat = (metadata.format || '').toUpperCase();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;
    const originalSize = imageBuffer.length;

    // --- COMPORTAMENTO PADRÃO RETRÓGRADO (PNG Otimização Inteligente) ---
    if (isDefaultBehavior) {
      let activeStrategies = [];
      if (metadata.palette === true) {
        activeStrategies = strategies.filter(s => s.name === 'palette=true');
      } else {
        activeStrategies = strategies;
      }

      const results = await Promise.all(
        activeStrategies.map(async (strat) => {
          try {
            const buffer = await strat.execute(sharpInstance, { quality: 90, compressionLevel: 9 });
            return { strategy: strat.name, size: buffer.length, buffer };
          } catch (err) {
            console.error(`[Estratégia] Falha ao executar ${strat.name}:`, err.message);
            return null;
          }
        })
      );

      const validResults = results.filter(r => r !== null);
      if (validResults.length === 0) {
        return res.status(500).json({ success: false, error: 'Erro interno ao processar a imagem.' });
      }

      const winner = validResults.sort((a, b) => a.size - b.size)[0];
      const optimizedSize = winner.size;
      const reductionPercent = (((originalSize - optimizedSize) / originalSize) * 100).toFixed(1);
      const processingTime = Date.now() - startTime;

      res.setHeader('X-Original-Size', originalSize.toString());
      res.setHeader('X-Optimized-Size', optimizedSize.toString());
      res.setHeader('X-Reduction-Percent', `${reductionPercent}%`);
      res.setHeader('X-Processing-Time', `${processingTime}ms`);
      res.setHeader('X-Optimization-Mode', winner.strategy);

      res.setHeader('Content-Type', 'image/png');
      res.send(winner.buffer);

      logConsole(req, 'PNG', 'PNG', originalWidth, originalHeight, originalWidth, originalHeight, 90, 1.0, originalSize, optimizedSize, reductionPercent, processingTime, winner.strategy);
      return;
    }

    // --- COMPORTAMENTO CUSTOMIZADO E PRESETS ---

    // 3. Resolver Preset
    let presetConfig = {};
    if (queryAndBody.preset) {
      const presetName = queryAndBody.preset.toLowerCase();
      if (PRESETS[presetName]) {
        presetConfig = PRESETS[presetName];
      } else {
        return res.status(400).json({
          success: false,
          error: `Preset inválido. Escolha entre: ${Object.keys(PRESETS).join(', ')}`
        });
      }
    }

    // 4. Mapear e Validar Parâmetros com Sobrescrita
    let format = queryAndBody.format || presetConfig.format || 'png';
    format = format.toLowerCase();
    if (format === 'jpg') format = 'jpeg';
    if (!['png', 'jpeg', 'webp'].includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'Formatos suportados: png, jpeg, webp.'
      });
    }

    let quality = null;
    const qVal = queryAndBody.quality !== undefined ? queryAndBody.quality : presetConfig.quality;
    if (qVal !== undefined) {
      const q = parseInt(qVal, 10);
      if (isNaN(q) || q < 1 || q > 100) {
        return res.status(400).json({
          success: false,
          error: 'O parâmetro quality deve estar entre 1 e 100.'
        });
      }
      quality = q;
    }

    let width = null;
    const wVal = queryAndBody.width !== undefined ? queryAndBody.width : presetConfig.width;
    if (wVal !== undefined) {
      const w = parseInt(wVal, 10);
      if (isNaN(w) || w <= 0) {
        return res.status(400).json({ success: false, error: 'O parâmetro width deve ser maior que 0.' });
      }
      width = w;
    }

    let height = null;
    const hVal = queryAndBody.height !== undefined ? queryAndBody.height : presetConfig.height;
    if (hVal !== undefined) {
      const h = parseInt(hVal, 10);
      if (isNaN(h) || h <= 0) {
        return res.status(400).json({ success: false, error: 'O parâmetro height deve ser maior que 0.' });
      }
      height = h;
    }

    let fit = queryAndBody.fit || presetConfig.fit || 'inside';
    fit = fit.toLowerCase();
    if (!['contain', 'cover', 'inside'].includes(fit)) {
      return res.status(400).json({
        success: false,
        error: 'O parâmetro fit deve ser contain, cover ou inside.'
      });
    }

    let stripMetadata = false;
    const smVal = queryAndBody.stripMetadata !== undefined ? queryAndBody.stripMetadata : presetConfig.stripMetadata;
    if (smVal !== undefined) {
      stripMetadata = smVal === true || smVal === 'true';
    }

    let targetSizeKB = null;
    const tsVal = queryAndBody.targetSizeKB !== undefined ? queryAndBody.targetSizeKB : presetConfig.targetSizeKB;
    if (tsVal !== undefined) {
      const ts = parseInt(tsVal, 10);
      if (isNaN(ts) || ts <= 0) {
        return res.status(400).json({ success: false, error: 'O parâmetro targetSizeKB deve ser maior que 0.' });
      }
      targetSizeKB = ts;
    }

    // 5. Execução da Otimização
    let outputBuffer = null;
    const startQ = quality || (format === 'png' ? 90 : 85);
    const minQ = getMinQuality(format);
    let finalQuality = startQ;
    let finalScale = 1.0;
    let optimizationMode = `preset=${queryAndBody.preset || 'custom'}`;
    let returnedOriginal = false;

    // Configurações do processamento
    const compressOpts = { width, height, fit, stripMetadata, originalWidth, originalHeight };

    // Primeira tentativa em qualidade padrão e escala cheia
    const initialBuffer = await compressImage(sharpInstance, format, startQ, 1.0, compressOpts);

    if (targetSizeKB) {
      const targetBytes = targetSizeKB * 1024;

      if (initialBuffer.length <= targetBytes) {
        outputBuffer = initialBuffer;
      } else {
        // Sequência de degradação estruturada: qualidade primeiro, depois escala
        const steps = [];
        
        if (format !== 'png') {
          // Passos de degradação de qualidade (JPEG e WebP)
          steps.push({ quality: Math.max(minQ, startQ - 5), scale: 1.0 });
          steps.push({ quality: Math.max(minQ, startQ - 10), scale: 1.0 });
          steps.push({ quality: Math.max(minQ, startQ - 15), scale: 1.0 });
          steps.push({ quality: Math.max(minQ, startQ - 20), scale: 1.0 });
          // Passos de degradação de escala
          steps.push({ quality: Math.max(minQ, startQ - 10), scale: 0.9 });
          steps.push({ quality: Math.max(minQ, startQ - 10), scale: 0.8 });
          steps.push({ quality: Math.max(minQ, startQ - 10), scale: 0.7 });
        } else {
          // PNG não usa redução de qualidade artificial; reduz direto a escala
          steps.push({ quality: startQ, scale: 0.9 });
          steps.push({ quality: startQ, scale: 0.8 });
          steps.push({ quality: startQ, scale: 0.7 });
        }

        // Deduplicar passos para evitar loops de processamento redundantes
        const uniqueSteps = [];
        const seen = new Set();
        for (const step of steps) {
          const key = `${step.quality}-${step.scale}`;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueSteps.push(step);
          }
        }

        const candidates = [{ buffer: initialBuffer, size: initialBuffer.length, quality: startQ, scale: 1.0 }];

        for (const step of uniqueSteps) {
          try {
            const buffer = await compressImage(sharpInstance, format, step.quality, step.scale, compressOpts);
            const size = buffer.length;
            candidates.push({ buffer, size, quality: step.quality, scale: step.scale });

            // Se atingir a faixa ideal (90% a 100%), interrompe imediatamente a iteração
            if (size <= targetBytes && size >= targetBytes * 0.9) {
              break;
            }
          } catch (err) {
            console.error(`[targetSizeKB] Falha na iteração Q:${step.quality}/S:${step.scale}:`, err.message);
          }
        }

        // Selecionar o buffer cuja diferença absoluta em relação ao alvo seja a menor
        candidates.sort((a, b) => Math.abs(a.size - targetBytes) - Math.abs(b.size - targetBytes));
        const winner = candidates[0];

        outputBuffer = winner.buffer;
        finalQuality = winner.quality;
        finalScale = winner.scale;
      }
      optimizationMode += `;targetSizeKB=${targetSizeKB};quality=${finalQuality};scale=${finalScale}`;
    } else {
      // Compressão simples sem limite de tamanho
      outputBuffer = initialBuffer;
      optimizationMode += `;quality=${finalQuality}`;
    }

    // 6. Comparação contra a Imagem Original
    const formatChanged = (format !== 'original') && (format !== originalFormat.toLowerCase());
    const optimizedSize = outputBuffer.length;

    if (optimizedSize > originalSize) {
      if (!formatChanged) {
        // Se a otimada for maior e não houve conversão de formato explícita, retorna a original
        outputBuffer = imageBuffer;
        returnedOriginal = true;
        optimizationMode += ';returned_original_smaller';
      } else {
        // Se houve conversão e ficou maior, logar o alerta
        console.warn(`[Aviso] A conversão explícita para ${format.toUpperCase()} gerou um arquivo maior (${formatSize(optimizedSize)}) do que a original (${formatSize(originalSize)}).`);
      }
    }

    const finalSize = outputBuffer.length;
    const reductionPercent = (((originalSize - finalSize) / originalSize) * 100).toFixed(1);
    const processingTime = Date.now() - startTime;

    // 7. Obter dimensões reais finais via metadados rápidos do Sharp
    const outputMetadata = await sharp(outputBuffer).metadata();
    const finalWidth = outputMetadata.width || originalWidth;
    const finalHeight = outputMetadata.height || originalHeight;

    // 8. Responder Requisição
    res.setHeader('X-Original-Size', originalSize.toString());
    res.setHeader('X-Optimized-Size', finalSize.toString());
    res.setHeader('X-Reduction-Percent', `${reductionPercent}%`);
    res.setHeader('X-Processing-Time', `${processingTime}ms`);
    res.setHeader('X-Optimization-Mode', optimizationMode);

    const wantsJson = (req.query.json === 'true') || (req.headers['accept'] && req.headers['accept'].includes('application/json'));

    if (wantsJson && !contentType.includes('multipart/form-data')) {
      res.json({
        success: true,
        image: `data:image/${format === 'jpeg' ? 'jpeg' : format};base64,${outputBuffer.toString('base64')}`,
        format,
        originalSize,
        optimizedSize: finalSize,
        reductionPercent: `${reductionPercent}%`,
        processingTimeMs: processingTime,
        optimizationMode
      });
    } else {
      res.setHeader('Content-Type', `image/${format === 'jpeg' ? 'jpeg' : format}`);
      res.send(outputBuffer);
    }

    // 9. Logs completos de depuração
    logConsole(req, originalFormat, format.toUpperCase(), originalWidth, originalHeight, finalWidth, finalHeight, finalQuality, finalScale, originalSize, finalSize, reductionPercent, processingTime, optimizationMode, returnedOriginal);

  } catch (err) {
    console.error('Erro de processamento da imagem:', err);
    return res.status(500).json({
      success: false,
      error: 'Erro interno ao processar a imagem.'
    });
  }
});

// Logs estruturados detalhados para depuração
function logConsole(req, fromFormat, toFormat, origW, origH, finalW, finalH, quality, scale, origSize, finalSize, reduction, time, mode, returnedOriginal) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const ip = req.ip || req.socket.remoteAddress;
  const userAgent = req.get('user-agent') || 'Unknown';

  console.log('--------------------------------------------------');
  console.log(`[${timestamp}]`);
  console.log(`${req.method} ${req.originalUrl}`);
  console.log(`IP: ${ip} | User-Agent: ${userAgent}`);
  console.log(`Formato: ${fromFormat} → ${toFormat}`);
  console.log(`Dimensões Originais: ${origW}x${origH}`);
  console.log(`Dimensões Finais: ${finalW}x${finalH}`);
  console.log(`Qualidade Utilizada: ${quality}`);
  console.log(`Escala Utilizada: ${scale.toFixed(2)}`);
  console.log(`Tamanho Original: ${formatSize(origSize)}`);
  console.log(`Tamanho Final: ${formatSize(finalSize)}`);
  console.log(`Redução: ${reduction}%`);
  console.log(`Tempo de Execução: ${time} ms`);
  console.log(`Modo de Otimização: ${mode}`);
  if (returnedOriginal) {
    console.log('[Info] Retornada imagem original porque a otimização resultou em tamanho maior.');
  }
  console.log('--------------------------------------------------');
}

// Middleware de tratamento global de erros
app.use((err, req, res, next) => {
  console.error('Erro global capturado:', err);
  return res.status(500).json({
    success: false,
    error: 'Erro interno ao processar a imagem.'
  });
});

app.listen(PORT, () => {
  console.log(`Servidor image-optimizer ativo na porta ${PORT}`);
});
