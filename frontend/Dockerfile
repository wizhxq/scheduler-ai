# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Build with empty VITE_API_URL so the frontend hits its own origin (/api/...)
# The nginx proxy then forwards those to the backend container
RUN VITE_API_URL= npm run build

# ---- serve stage ----
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Use our custom nginx config that proxies /api/ to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
