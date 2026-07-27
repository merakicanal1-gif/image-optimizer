# Image Optimizer API

Uma API HTTP de alta performance para otimização extrema de imagens PNG, desenvolvida em Node.js usando Express e a biblioteca Sharp. Perfeita para integração com n8n (otimizando imagens geradas pelo Browserless antes do envio via WhatsApp), automações ou microsserviços.

---

## Como a Decisão de Otimização é Tomada

A API possui um motor de **Otimização Inteligente e Extensível**. O fluxo de execução de uma requisição segue o diagrama abaixo:

```text
Imagem Recebida (Multipart ou Octet-Stream)
↓
Leitura de Metadados via Sharp (Resolução, Formato e Paleta)
↓
Seleção de Estratégias Válidas (Otimização Opcional)
  ├─ Se a imagem original já for paletizada (metadata.palette === true):
  │  └─ Executa APENAS a estratégia "palette=true" (evita reconversão para RGB e overhead de CPU)
  └─ Caso contrário (JPEG, WebP, etc.):
     └─ Executa TODAS as estratégias ativas concorrentemente
↓
Processamento em Paralelo (Promise.all)
  ├─ Estratégia A: sem paletização (palette=false)
  └─ Estratégia B: com paletização (palette=true)
↓
Comparação de Resultados
  ├─ Coleta o tamanho (bytes) dos buffers resultantes
  └─ Seleciona o vencedor inicial (menor tamanho em bytes)
↓
Retorno do PNG Otimizado
  ├─ Adiciona cabeçalhos personalizados (X-Original-Size, X-Optimized-Size, etc.)
  └─ Envia buffer binário (image/png)
```

### Qualidade Visual vs. Tamanho de Arquivo

A biblioteca Sharp nativa não calcula métricas de distorção de imagem (como SSIM ou PSNR) sem dependências adicionais compiladas no sistema operacional. Por essa razão, por padrão, o algoritmo de otimização seleciona a imagem com o menor tamanho de arquivo. 

No entanto, a arquitetura deste projeto foi projetada para ser **extensível**. O código de ordenação das estratégias permite plugar facilmente uma função analisadora de qualidade visual no futuro, sem qualquer alteração na interface da API pública.

---

## Detalhes de Otimização PNG

Para imagens PNG, o parâmetro `quality` da URL é mantido apenas por compatibilidade com APIs legadas (embora ele guie a quantização interna quando `palette=true`). A compressão real e redução de tamanho dependem dos seguintes fatores que configuramos no Sharp:

1. **`compressionLevel` (0-9)**: Ajustado no nível máximo `9` para obter a melhor taxa de compressão zlib.
2. **`palette: true` (Quantização)**: Reduz a imagem a uma paleta indexada de até 256 cores (semelhante ao `pngquant`), reduzindo drasticamente o tamanho (até 80%) enquanto preserva a transparência (canal alfa) e a nitidez.
3. **`effort` (1-10)**: Definido no valor máximo `10` (esforço total de CPU) para encontrar a melhor combinação possível de filtros e compressão de linha.
4. **`adaptiveFiltering: true`**: Habilita a filtragem adaptativa de linha para reduzir padrões repetitivos antes da compressão zlib.
5. **Remoção de Metadados**: Discarda automaticamente tags EXIF/XMP/IPTC não críticas da imagem original para economizar bytes preciosos.

A API **nunca** altera a largura, altura, resolução ou proporção da imagem original.

---

## Tecnologias Utilizadas

- **Node.js 22**
- **Express.js** (Servidor HTTP rápido e leve)
- **Sharp** (Processamento de imagem ultrarrápido baseado na libvips)
- **Multer** (Tratamento de uploads de arquivos multipart)

---

## Rotas da API

### `GET /health`
Verifica a integridade e tempo de atividade da aplicação.
- **Resposta (JSON):**
  ```json
  {
    "success": true,
    "status": "ok",
    "version": "1.0.0",
    "uptime": 124,
    "node": "v22.5.0"
  }
  ```

### `GET /info`
Retorna dados de versão do microsserviço e das principais dependências.
- **Resposta (JSON):**
  ```json
  {
    "service": "image-optimizer",
    "version": "1.0.0",
    "node": "v22.5.0",
    "sharp": "0.33.5"
  }
  ```

### `POST /optimize`
Recebe e otimiza a imagem, retornando o binário PNG diretamente.

#### Parâmetros de Query String (Opcionais):
- `quality` (1 a 100): Padrão `90`.
- `compressionLevel` (0 a 9): Padrão `9`.
- `palette` (`true` ou `false`): Padrão de comportamento inteligente (roda as duas e compara se omitido, ou força o modo se especificado).

#### Cabeçalhos de Resposta:
- `X-Original-Size`: Tamanho original da imagem em bytes.
- `X-Optimized-Size`: Tamanho otimizado da imagem em bytes.
- `X-Reduction-Percent`: Percentual de redução de tamanho (ex: `75.4%`).
- `X-Processing-Time`: Tempo total de processamento em ms (ex: `54ms`).
- `X-Optimization-Mode`: A estratégia que venceu e foi retornada (ex: `palette=true`).

---

## Instalação e Execução Local

### Pré-requisitos
- Node.js v22 ou superior instalado.

### Passos
1. Clone este repositório.
2. Acesse a pasta do projeto:
   ```bash
   cd image-optimizer
   ```
3. Instale as dependências:
   ```bash
   npm install
   ```
4. Inicie o servidor em ambiente de desenvolvimento (com recarregamento automático):
   ```bash
   npm run dev
   ```
5. Para executar em produção:
   ```bash
   npm start
   ```

O servidor estará disponível em `http://localhost:3000`.

---

## Executando via Docker

Para rodar de forma isolada em produção utilizando Docker:

1. Construa a imagem:
   ```bash
   docker build -t image-optimizer .
   ```
2. Inicie o container mapeando a porta 3000:
   ```bash
   docker run -d -p 3000:3000 --name image-optimizer-app image-optimizer
   ```

---

## Deploy no Easypanel

Este projeto está pronto para deploy imediato no **Easypanel** (plataforma de hospedagem baseada em Docker).

1. No painel do seu Easypanel, crie um novo **Serviço de Aplicação (App)**.
2. Na aba **Source**, aponte para o repositório Git correspondente a este projeto.
3. Certifique-se de que a porta exposta nas configurações do Easypanel é a **3000**.
4. O Easypanel detectará automaticamente o `Dockerfile` contido na raiz do projeto e construirá a imagem baseada em `node:22-alpine` sem necessidade de configurações adicionais.

---

## Exemplos de Uso (cURL)

### Exemplo 1: Enviando via `multipart/form-data` (Upload de Arquivo)
```bash
curl -X POST "http://localhost:3000/optimize?quality=85" \
  -F "image=@imagem_teste.jpg" \
  --output imagem_otimizada.png
```

### Exemplo 2: Enviando via `application/octet-stream` (Binário Direto no Corpo)
```bash
curl -X POST "http://localhost:3000/optimize?quality=80" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@imagem_teste.jpg" \
  --output imagem_otimizada.png
```

---

## Integração com o n8n

O nó **HTTP Request** do n8n pode enviar a imagem vinda de nós anteriores (como o Browserless) de forma extremamente fácil.

### Configuração com `application/octet-stream` (Recomendado)

Esta abordagem envia o arquivo de forma direta e limpa.

1. Adicione o nó **HTTP Request** ao seu fluxo.
2. Configure os parâmetros:
   - **Method**: `POST`
   - **URL**: `http://<IP_DO_SEU_EASYPANEL>:3000/optimize`
   - **Authentication**: (Opcional, conforme configurado)
   - **Send Body**: Marcar como `true`
   - **Body Content Type**: `n8n Binary File`
   - **Input Data Field Name**: O nome do seu campo binário do n8n (comum: `data`)
3. Nas opções de cabeçalhos do nó HTTP Request:
   - Defina `Content-Type` como `application/octet-stream`.
4. Em **Response Format**, marque como **File** para receber o PNG otimizado e enviá-lo diretamente nas próximas etapas (ex: WhatsApp).

### Configuração com `multipart/form-data`

Caso o webhook recebedor precise obrigatoriamente de um formato de upload tradicional:

1. No nó **HTTP Request**:
   - **Method**: `POST`
   - **URL**: `http://<IP_DO_SEU_EASYPANEL>:3000/optimize`
   - **Send Body**: Marcar como `true`
   - **Body Content Type**: `Multipart-Form-Data`
2. Em **Specify Body**, defina um parâmetro com:
   - **Name**: `image`
   - **Parameter Type**: `Form Data Binary`
   - **Input Data Field Name**: O nome do seu campo binário no n8n (normalmente `data`).
3. Configure o formato de resposta como **File**.
