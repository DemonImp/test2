const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// 存储WhatsApp客户端实例
let whatsappClient = null;
let isClientReady = false;
let qrCodeData = null;
let clientInfo = null;

/**
 * 初始化WhatsApp客户端
 */
function initializeWhatsAppClient() {
    console.log('🚀 初始化 WhatsApp 客户端...');
    
    whatsappClient = new Client({
        authStrategy: new LocalAuth({
            clientId: "atguigu-whatsapp-client"
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });

    // QR码生成事件
    whatsappClient.on('qr', async (qr) => {
        console.log('📱 生成登录二维码');
        qrCodeData = qr;
        
        try {
            // 生成二维码图片
            const qrCodeImage = await QRCode.toDataURL(qr);
            console.log('✅ 二维码生成成功');
            
            // 通知Java后端（如果配置了回调URL）
            if (process.env.JAVA_BACKEND_URL) {
                notifyJavaBackend('qr_generated', {
                    qrCode: qr,
                    qrCodeImage: qrCodeImage
                });
            }
        } catch (error) {
            console.error('❌ 二维码生成失败:', error);
        }
    });

    // 认证成功事件
    whatsappClient.on('authenticated', (session) => {
        console.log('✅ WhatsApp 认证成功');
        if (process.env.JAVA_BACKEND_URL) {
            notifyJavaBackend('authenticated', { session });
        }
    });

    // 客户端准备就绪事件
    whatsappClient.on('ready', () => {
        console.log('🎉 WhatsApp 客户端准备就绪');
        isClientReady = true;
        
        // 获取客户端信息
        clientInfo = {
            phoneNumber: whatsappClient.info.wid.user,
            displayName: whatsappClient.info.pushname || whatsappClient.info.wid.user,
            platform: whatsappClient.info.platform,
            battery: whatsappClient.info.battery,
            plugged: whatsappClient.info.plugged
        };
        
        console.log('📱 客户端信息:', clientInfo);
        
        if (process.env.JAVA_BACKEND_URL) {
            notifyJavaBackend('ready', {
                clientInfo: clientInfo
            });
        }
    });

    // 认证失败事件
    whatsappClient.on('auth_failure', (msg) => {
        console.error('❌ WhatsApp 认证失败:', msg);
        isClientReady = false;
        qrCodeData = null;
        
        if (process.env.JAVA_BACKEND_URL) {
            notifyJavaBackend('auth_failure', { error: msg });
        }
    });

    // 断开连接事件
    whatsappClient.on('disconnected', (reason) => {
        console.log('🔌 WhatsApp 连接断开:', reason);
        isClientReady = false;
        qrCodeData = null;
        
        if (process.env.JAVA_BACKEND_URL) {
            notifyJavaBackend('disconnected', { reason });
        }
    });

    // 消息接收事件
    whatsappClient.on('message', async (message) => {
        console.log('📨 收到新消息:', {
            from: message.from,
            body: message.body,
            timestamp: message.timestamp
        });
        
        if (process.env.JAVA_BACKEND_URL) {
            notifyJavaBackend('message_received', {
                from: message.from,
                to: message.to,
                body: message.body,
                timestamp: message.timestamp,
                messageId: message.id._serialized,
                type: message.type,
                isGroup: message.from.includes('@g.us')
            });
        }
    });

    // 初始化客户端
    whatsappClient.initialize();
}

/**
 * 通知Java后端
 */
async function notifyJavaBackend(event, data) {
    if (!process.env.JAVA_BACKEND_URL) return;
    
    try {
        await axios.post(`${process.env.JAVA_BACKEND_URL}/api/whatsapp/webhook/${event}`, {
            event,
            data,
            timestamp: new Date().toISOString()
        }, {
            timeout: 5000
        });
        console.log(`📤 已通知Java后端: ${event}`);
    } catch (error) {
        console.error(`❌ 通知Java后端失败: ${event}`, error.message);
    }
}

// ==================== HTTP API 接口 ====================

/**
 * 健康检查接口
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        isClientReady: isClientReady,
        hasQRCode: !!qrCodeData,
        clientInfo: clientInfo
    });
});

/**
 * 获取客户端状态
 */
app.get('/status', (req, res) => {
    res.json({
        status: 'success',
        isReady: isClientReady,
        hasQRCode: !!qrCodeData,
        clientInfo: clientInfo,
        timestamp: new Date().toISOString()
    });
});

/**
 * 获取登录二维码
 */
app.get('/qr', async (req, res) => {
    try {
        if (!qrCodeData) {
            return res.status(404).json({
                status: 'error',
                message: '二维码不存在，请等待生成'
            });
        }

        // 生成二维码图片
        const qrCodeImage = await QRCode.toDataURL(qrCodeData);
        qrcode.generate(qrCodeData, { small: true });//二维码打印
        res.json({
            status: 'success',
            qrCode: qrCodeData,
            qrCodeImage: qrCodeImage,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('获取二维码失败:', error);
        res.status(500).json({
            status: 'error',
            message: '获取二维码失败: ' + error.message
        });
    }
});

/**
 * 获取用户列表
 */
app.get('/users', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({
                status: 'error',
                message: 'WhatsApp客户端未准备就绪'
            });
        }

        // 获取所有聊天
        const chats = await whatsappClient.getChats();
        
        // 过滤出个人聊天（非群组）
        const users = chats
            .filter(chat => !chat.isGroup)
            .map(chat => ({
                id: chat.id._serialized,
                name: chat.name || chat.id.user,
                phoneNumber: chat.id.user,
                isOnline: chat.presence?.state === 'available',
                lastSeen: chat.presence?.lastSeen,
                unreadCount: chat.unreadCount,
                lastMessage: chat.lastMessage ? {
                    body: chat.lastMessage.body,
                    timestamp: chat.lastMessage.timestamp
                } : null
            }));

        res.json({
            status: 'success',
            users: users,
            total: users.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('获取用户列表失败:', error);
        res.status(500).json({
            status: 'error',
            message: '获取用户列表失败: ' + error.message
        });
    }
});

/**
 * 发送消息
 */
app.post('/send-message', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                status: 'error',
                message: '手机号和消息内容不能为空'
            });
        }

        if (!isClientReady) {
            return res.status(400).json({
                status: 'error',
                message: 'WhatsApp客户端未准备就绪'
            });
        }

        // 格式化手机号
        const formattedNumber = phoneNumber.includes('@') 
            ? phoneNumber 
            : `${phoneNumber}@c.us`;

        // 发送消息
        const result = await whatsappClient.sendMessage(formattedNumber, message);
        
        console.log('📤 消息发送成功:', {
            to: phoneNumber,
            message: message,
            messageId: result.id._serialized
        });

        res.json({
            status: 'success',
            message: '消息发送成功',
            messageId: result.id._serialized,
            to: phoneNumber,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('发送消息失败:', error);
        res.status(500).json({
            status: 'error',
            message: '发送消息失败: ' + error.message
        });
    }
});

/**
 * 批量发送消息
 */
app.post('/send-batch-messages', async (req, res) => {
    try {
        const { messages } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: '消息列表不能为空'
            });
        }

        if (!isClientReady) {
            return res.status(400).json({
                status: 'error',
                message: 'WhatsApp客户端未准备就绪'
            });
        }

        const results = [];
        
        for (const msg of messages) {
            try {
                const { phoneNumber, message } = msg;
                
                if (!phoneNumber || !message) {
                    results.push({
                        phoneNumber: phoneNumber || 'unknown',
                        status: 'error',
                        message: '手机号或消息内容为空'
                    });
                    continue;
                }

                const formattedNumber = phoneNumber.includes('@') 
                    ? phoneNumber 
                    : `${phoneNumber}@c.us`;

                const result = await whatsappClient.sendMessage(formattedNumber, message);
                
                results.push({
                    phoneNumber: phoneNumber,
                    status: 'success',
                    messageId: result.id._serialized
                });
                
                // 添加延迟避免发送过快
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                results.push({
                    phoneNumber: msg.phoneNumber || 'unknown',
                    status: 'error',
                    message: error.message
                });
            }
        }

        res.json({
            status: 'success',
            results: results,
            total: messages.length,
            successCount: results.filter(r => r.status === 'success').length,
            errorCount: results.filter(r => r.status === 'error').length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('批量发送消息失败:', error);
        res.status(500).json({
            status: 'error',
            message: '批量发送消息失败: ' + error.message
        });
    }
});

/**
 * 获取聊天历史
 */
app.get('/chat-history/:phoneNumber', async (req, res) => {
    try {
        const { phoneNumber } = req.params;
        const { limit = 50 } = req.query;

        if (!isClientReady) {
            return res.status(400).json({
                status: 'error',
                message: 'WhatsApp客户端未准备就绪'
            });
        }

        const formattedNumber = phoneNumber.includes('@') 
            ? phoneNumber 
            : `${phoneNumber}@c.us`;

        // 获取聊天
        const chat = await whatsappClient.getChatById(formattedNumber);
        
        if (!chat) {
            return res.status(404).json({
                status: 'error',
                message: '聊天不存在'
            });
        }

        // 获取消息历史
        const messages = await chat.fetchMessages({ limit: parseInt(limit) });
        
        const messageHistory = messages.map(msg => ({
            id: msg.id._serialized,
            body: msg.body,
            from: msg.from,
            to: msg.to,
            timestamp: msg.timestamp,
            type: msg.type,
            isFromMe: msg.fromMe
        }));

        res.json({
            status: 'success',
            phoneNumber: phoneNumber,
            messages: messageHistory,
            total: messageHistory.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('获取聊天历史失败:', error);
        res.status(500).json({
            status: 'error',
            message: '获取聊天历史失败: ' + error.message
        });
    }
});

/**
 * 重新初始化客户端
 */
app.post('/reinitialize', async (req, res) => {
    try {
        console.log('🔄 重新初始化WhatsApp客户端...');
        
        if (whatsappClient) {
            await whatsappClient.destroy();
        }
        
        isClientReady = false;
        qrCodeData = null;
        clientInfo = null;
        
        // 延迟后重新初始化
        setTimeout(() => {
            initializeWhatsAppClient();
        }, 2000);
        
        res.json({
            status: 'success',
            message: '客户端重新初始化中...',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('重新初始化失败:', error);
        res.status(500).json({
            status: 'error',
            message: '重新初始化失败: ' + error.message
        });
    }
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Web集成服务启动成功`);
    console.log(`📡 服务地址: http://localhost:${PORT}`);
    console.log(`📋 API文档:`);
    console.log(`   GET  /health - 健康检查`);
    console.log(`   GET  /status - 获取状态`);
    console.log(`   GET  /qr - 获取二维码`);
    console.log(`   GET  /users - 获取用户列表`);
    console.log(`   POST /send-message - 发送消息`);
    console.log(`   POST /send-batch-messages - 批量发送消息`);
    console.log(`   GET  /chat-history/:phoneNumber - 获取聊天历史`);
    console.log(`   POST /reinitialize - 重新初始化`);
    console.log('');
    
    // 初始化WhatsApp客户端
    initializeWhatsAppClient();
});

// 优雅关闭
process.on('SIGINT', async () => {
    console.log('\n🛑 正在关闭服务...');
    
    if (whatsappClient) {
        await whatsappClient.destroy();
    }
    
    console.log('✅ 服务已关闭');
    process.exit(0);
});
