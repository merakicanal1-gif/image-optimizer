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

// Definição das estratégias de otimização
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
      quality: params.quality, // Utilizado para guiar a quantização do palette
      effort: 10,
      adaptiveFiltering: true
    }).toBuffer()
  }
];

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
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    node: process.version
  });
});

// Rota GET /info
app.get('/info', (req, res) => {
  res.json({
    service: 'image-optimizer',
    version: '1.0.0',
    node: process.version,
    sharp: sharp.versions.sharp
  });
});

// Rota POST /optimize
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
  } else {
    return res.status(400).json({
      success: false,
      error: 'Content-Type inválido. Use multipart/form-data ou application/octet-stream.'
    });
  }
}, async (req, res) => {
  const startTime = Date.now();

  // Validar Query Parameters
  let quality = 90;
  if (req.query.quality !== undefined) {
    const q = parseInt(req.query.quality, 10);
    if (isNaN(q) || q < 1 || q > 100) {
      return res.status(400).json({
        success: false,
        error: 'O parâmetro quality deve estar entre 1 e 100.'
      });
    }
    quality = q;
  }

  let compressionLevel = 9;
  if (req.query.compressionLevel !== undefined) {
    const c = parseInt(req.query.compressionLevel, 10);
    if (isNaN(c) || c < 0 || c > 9) {
      return res.status(400).json({
        success: false,
        error: 'O parâmetro compressionLevel deve estar entre 0 e 9.'
      });
    }
    compressionLevel = c;
  }

  let explicitPalette = null;
  if (req.query.palette !== undefined) {
    const p = req.query.palette.toLowerCase();
    if (p !== 'true' && p !== 'false') {
      return res.status(400).json({
        success: false,
        error: 'O parâmetro palette deve ser true ou false.'
      });
    }
    explicitPalette = p === 'true';
  }

  // Extrair buffer da imagem
  let imageBuffer;
  if (req.file) {
    imageBuffer = req.file.buffer;
  } else if (req.body && Buffer.isBuffer(req.body)) {
    imageBuffer = req.body;
  }

  if (!imageBuffer || imageBuffer.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Arquivo de imagem não enviado.'
    });
  }

  try {
    const sharpInstance = sharp(imageBuffer);
    const metadata = await sharpInstance.metadata();
    const originalFormat = (metadata.format || '').toUpperCase();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    // Selecionar estratégias ativas
    let activeStrategies = [];
    if (explicitPalette !== null) {
      activeStrategies = strategies.filter(s => s.name === `palette=${explicitPalette}`);
    } else if (metadata.palette === true) {
      // Otimização opcional: Se a imagem já é baseada em paleta (<= 256 cores),
      // pular a estratégia palette=false para evitar processamento desnecessário e aumento de tamanho.
      activeStrategies = strategies.filter(s => s.name === 'palette=true');
    } else {
      activeStrategies = strategies;
    }

    // Executar estratégias ativas concorrentemente
    const results = await Promise.all(
      activeStrategies.map(async (strat) => {
        try {
          const buffer = await strat.execute(sharpInstance, { quality, compressionLevel });
          return {
            strategy: strat.name,
            size: buffer.length,
            buffer: buffer
          };
        } catch (err) {
          console.error(`[Estratégia] Falha ao executar ${strat.name}:`, err.message);
          return null;
        }
      })
    );

    // Filtrar resultados válidos
    const validResults = results.filter(r => r !== null);

    if (validResults.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Erro interno ao processar a imagem.'
      });
    }

    // Escolha da melhor estratégia
    // Atualmente baseado em tamanho. Projetado para suportar métricas de qualidade visual (como SSIM) futuramente.
    const winner = validResults.sort((a, b) => a.size - b.size)[0];

    const originalSize = imageBuffer.length;
    const optimizedSize = winner.size;
    const reductionPercent = (((originalSize - optimizedSize) / originalSize) * 100).toFixed(1);
    const processingTime = Date.now() - startTime;

    // Adicionar cabeçalhos de resposta customizados
    res.setHeader('X-Original-Size', originalSize.toString());
    res.setHeader('X-Optimized-Size', optimizedSize.toString());
    res.setHeader('X-Reduction-Percent', `${reductionPercent}%`);
    res.setHeader('X-Processing-Time', `${processingTime}ms`);
    res.setHeader('X-Optimization-Mode', winner.strategy);

    // Responder diretamente com o buffer da imagem
    res.setHeader('Content-Type', 'image/png');
    res.send(winner.buffer);

    // Logs no console formatados conforme especificação
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.get('user-agent') || 'Unknown';

    console.log('--------------------------------------------------');
    console.log(`[${timestamp}]`);
    console.log(`${req.method} ${req.originalUrl}`);
    console.log(`IP: ${ip} | User-Agent: ${userAgent}`);
    console.log(`Formato: ${originalFormat} → PNG`);
    console.log(`Dimensões: ${width}x${height}`);
    console.log(`Original: ${formatSize(originalSize)}`);
    console.log(`Otimizada: ${formatSize(optimizedSize)}`);
    console.log(`Redução: ${reductionPercent}%`);
    console.log(`Tempo: ${processingTime} ms`);
    console.log(`Modo escolhido: ${winner.strategy}`);
    console.log('--------------------------------------------------');

  } catch (err) {
    console.error('Erro de processamento da imagem:', err);
    return res.status(500).json({
      success: false,
      error: 'Erro interno ao processar a imagem.'
    });
  }
});

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
