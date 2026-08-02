# Image Optimizer API (Stateless v1.0)

Uma API HTTP stateless de alta performance para processamento e otimização de imagens em memória utilizando a biblioteca Sharp e Express. A aplicação opera de maneira totalmente efêmera: recebe a imagem, processa as otimizações requisitadas e devolve diretamente o binário otimizado, sem persistir nada em disco e sem gerar arquivos locais.

---

## Funcionalidades e Regras de Negócio (v1.0)

Esta versão foi desenvolvida com foco em estabilidade de produção, processamento determinístico, alta performance (baixo consumo de CPU/memória) e preservação visual rigorosa de textos, preços e logotipos.

### 1. Formatos Suportados (`format`)
- `png` (padrão se nenhum formato for informado)
- `jpeg` (ou `jpg`)
- `webp`

### 2. Presets Prontos
Qualquer parâmetro explícito enviado na requisição sobrescreve a configuração correspondente do preset.
- **`whatsapp`**: `format=jpeg`, `width=1080`, `quality=78`, `fit=inside`, `stripMetadata=true` (Gera arquivos normalmente entre 120 KB e 180 KB sem perda perceptível de qualidade).
- **`telegram`**: `format=jpeg`, `width=1280`, `quality=82`, `fit=inside`, `stripMetadata=true` (Gera arquivos normalmente entre 150 KB e 250 KB priorizando excelente qualidade visual).
- **`thumbnail`**: `format=png`, `width=200`, `height=200`, `fit=cover`, `stripMetadata=true` (Formato PNG com corte central e metadados removidos).

### 3. Proteções de Otimização
- **Sem Ampliação (`withoutEnlargement`)**: Imagens com dimensões menores do que a resolução do preset ou parâmetros enviados **nunca** serão esticadas ou ampliadas. Elas mantêm suas dimensões originais.
- **Comparação de Tamanho**: Se a imagem otimizada resultar em um arquivo maior em bytes do que a imagem original recebida, a API retornará automaticamente o buffer original (exceto se houver uma conversão explícita de formato solicitada pelo usuário).
- **Qualidade Mínima por Formato**:
  - `jpeg`: qualidade mínima de `55`
  - `webp`: qualidade mínima de `60`
  - `png`: sem limite artificial (usa compressão nativa baseada no Sharp)

---

## Como o Algoritmo `targetSizeKB` Funciona

O algoritmo de aproximação do `targetSizeKB` opera em memória de maneira iterativa e de alta performance:

1. **Verificação Preliminar**: Processa a imagem na escala original (1.0) e qualidade inicial. Se o tamanho final já for menor ou igual ao `targetSizeKB` solicitado, o processamento é interrompido e a imagem é retornada **imediatamente**.
2. **Degradação Sequencial Controlada**:
   - **Qualidade Primeiro**: Reduz a qualidade da compressão de 5 em 5 unidades em até 4 passos (ex: `quality - 5`, `quality - 10`, `quality - 15`, `quality - 20`), respeitando os limites mínimos de cada formato para evitar que textos e logotipos fiquem ilegíveis.
   - **Resolução depois (Último Recurso)**: Se a imagem ainda estiver acima do peso alvo após a redução de qualidade, a API diminui a escala de resolução gradualmente (`90%`, `80%`, `70%`), nunca reduzindo a escala abaixo de `70%`.
3. **Deduplicação de Passos**: Passos repetidos (por limitação de qualidade mínima) são pulados automaticamente para poupar processamento.
4. **Escolha da Melhor Imagem**: Todos os buffers gerados são coletados e comparados. A API seleciona e retorna o buffer com o tamanho **mais próximo** do alvo em bytes (diferença absoluta mínima), seja ligeiramente acima ou abaixo.

---

## Executando Localmente

### Pré-requisitos
- Node.js v22 ou superior instalado.

### Passos
1. Instale as dependências:
   ```bash
   npm install
   ```
2. Inicialize o servidor em modo de desenvolvimento (com recarregamento automático):
   ```bash
   npm run dev
   ```

O servidor estará escutando na porta `3000` (`http://localhost:3000`).

---

## Exemplos de Requisição e Resposta

### 1. Upload via Multipart Form (`multipart/form-data`)
```bash
curl -X POST "http://localhost:3000/optimize?preset=whatsapp" \
  -F "image=@imagem_teste.png" \
  --output imagem_whatsapp.jpg
```

**Cabeçalhos de Resposta Esperados:**
- `Content-Type`: `image/jpeg`
- `X-Original-Size`: `1852031` (bytes)
- `X-Optimized-Size`: `142512` (bytes)
- `X-Reduction-Percent`: `92.3%`
- `X-Processing-Time`: `82ms`
- `X-Optimization-Mode`: `preset=whatsapp;quality=78`

---

### 2. Upload via Corpo Binário (`application/octet-stream`)
```bash
curl -X POST "http://localhost:3000/optimize?format=webp&quality=80&targetSizeKB=150" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@imagem_teste.png" \
  --output imagem_otimizada.webp
```

---

### 3. Requisição via JSON (`application/json`) com Saída JSON
```bash
curl -X POST "http://localhost:3000/optimize?json=true" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "preset": "thumbnail"}'
```

**Resposta (JSON):**
```json
{
  "success": true,
  "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "format": "png",
  "originalSize": 85,
  "optimizedSize": 85,
  "reductionPercent": "0.0%",
  "processingTimeMs": 12,
  "optimizationMode": "preset=thumbnail;quality=80;returned_original_smaller"
}
```

---

## Configuração no n8n

O nó **HTTP Request** do n8n pode consumir esta API de forma stateless:

1. Adicione o nó **HTTP Request**.
2. Configure os parâmetros principais:
   - **Method**: `POST`
   - **URL**: `http://<IP_DO_MICROSERVICO>:3000/optimize?preset=whatsapp`
   - **Send Body**: `true`
   - **Body Content Type**: `n8n Binary File`
   - **Input Data Field Name**: O nome do seu campo binário (ex: `data` ou `image`)
3. Adicione no cabeçalho (Headers) do nó HTTP Request:
   - `Content-Type`: `application/octet-stream`
4. Em **Response Format**, selecione **File**.
