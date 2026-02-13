# Sử dụng node phiên bản nhẹ (LTS)
FROM node:18-slim

# Tạo thư mục làm việc trong container
WORKDIR /app

# Copy package.json và package-lock.json trước để tận dụng cache của Docker
COPY package*.json ./

# Cài đặt các thư viện cần thiết
RUN npm install --production

# Copy toàn bộ mã nguồn vào container
COPY . .

# Tạo thư mục cho logs và history nếu chưa có
RUN mkdir -p anchorDepin

# Chạy ứng dụng
CMD ["node", "index.js"]