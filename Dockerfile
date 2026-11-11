# CITshop, sem etapa de build. O Coolify injeta as env vars como build ARG (inclusive
# NODE_ENV=production); aqui não há devDependency nem compilação, então é inofensivo.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache fontconfig ttf-dejavu

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY servidor/ ./servidor/
COPY publico/  ./publico/
COPY manual.json ./

# Lojas, produtos, fotos e afiliados vivem aqui: TEM de ser volume persistente no Coolify.
ENV DADOS_DIR=/app/dados
RUN mkdir -p /app/dados && chown -R node:node /app/dados

USER node
EXPOSE 3000
CMD ["node", "servidor/servidor.js"]
