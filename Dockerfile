FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY javhd-test-hook.js ./
COPY data ./data
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node","--import","./javhd-test-hook.js","server.js"]
