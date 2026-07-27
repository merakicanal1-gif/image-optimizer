# Stage 1: Instalação de dependências de produção
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --omit=dev

# Stage 2: Imagem final para execução
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Copia dependências instaladas e código fonte
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./

# O Easypanel mapeia e expõe portas automaticamente, mas o padrão do projeto é 3000
EXPOSE 3000

# Execução direta com o node para repasse correto de sinais do SO (ex: SIGTERM)
CMD ["node", "server.js"]
