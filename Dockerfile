FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY data ./data
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node","server.js"]
