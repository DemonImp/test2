const express = require('express');
const path = require('path');

const app = express();
const PORT = 3002;

// 静态文件服务
app.use(express.static('public'));

// 主页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API 代理路由
app.get('/api/*', (req, res) => {
    const apiUrl = `http://localhost:3001${req.path}`;
    
    // 简单的代理实现
    const http = require('http');
    const options = {
        hostname: 'localhost',
        port: 3001,
        path: req.path,
        method: req.method,
        headers: req.headers
    };
    
    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
        res.status(500).json({ error: err.message });
    });
    
    proxyReq.end();
});

app.listen(PORT, () => {
    console.log(`🌐 Web界面启动成功: http://localhost:${PORT}`);
});

