const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

// Middleware
app.use(express.static('.'));
app.use(express.json());

// ==============================================
// API CONFIGURATION - 9 ACCOUNTS
// ==============================================

const API_CONFIGS = [
    {
        name: 'OpenAI-1',
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY_1,
        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
        enabled: true,
        priority: 1
    },
    {
        name: 'OpenAI-2',
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY_2,
        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
        enabled: true,
        priority: 2
    },
    {
        name: 'OpenAI-3',
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY_3,
        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
        enabled: true,
        priority: 3
    },
    {
        name: 'OpenAI-4',
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY_4,
        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
        enabled: true,
        priority: 4
    },
    {
        name: 'OpenAI-5',
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY_5,
        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
        enabled: true,
        priority: 5
    },
    {
        name: 'HuggingFace-1',
        type: 'huggingface',
        apiKey: process.env.HUGGINGFACE_API_KEY_1,
        endpoint: 'https://api-inference.huggingface.co/models/openai/whisper-large-v3',
        enabled: true,
        priority: 6
    }
];

// Stats tracking
let currentApiIndex = 0;
let apiStats = API_CONFIGS.map(api => ({
    name: api.name,
    type: api.type,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    lastUsed: null,
    lastError: null,
    averageResponseTime: 0
}));

// ==============================================
// API CALL FUNCTIONS
// ==============================================

async function callOpenAI(audioBuffer, language, apiConfig) {
    console.log(`📞 Calling ${apiConfig.name}...`);
    
    const formData = new FormData();
    formData.append('file', audioBuffer, {
        filename: 'audio.webm',
        contentType: 'audio/webm'
    });
    formData.append('model', 'whisper-1');
    
    if (language && language !== 'auto') {
        formData.append('language', language);
    }

    const startTime = Date.now();
    
    try {
        const response = await axios.post(
            apiConfig.endpoint,
            formData,
            {
                headers: {
                    'Authorization': `Bearer ${apiConfig.apiKey}`,
                    ...formData.getHeaders()
                },
                timeout: 60000, // 60 seconds timeout
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            }
        );

        const responseTime = Date.now() - startTime;
        console.log(`✅ ${apiConfig.name} success in ${responseTime}ms`);
        
        return {
            text: response.data.text,
            responseTime
        };
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error(`❌ ${apiConfig.name} failed:`, error.response?.data || error.message);
        
        throw new Error(
            error.response?.data?.error?.message || 
            error.message || 
            'OpenAI API failed'
        );
    }
}

async function callHuggingFace(audioBuffer, language, apiConfig) {
    console.log(`📞 Calling ${apiConfig.name}...`);
    
    const startTime = Date.now();
    
    try {
        const response = await axios.post(
            apiConfig.endpoint,
            audioBuffer,
            {
                headers: {
                    'Authorization': `Bearer ${apiConfig.apiKey}`,
                    'Content-Type': 'audio/webm'
                },
                timeout: 120000, // 2 minutes - HuggingFace can be slow
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            }
        );

        const responseTime = Date.now() - startTime;
        
        // HuggingFace returns: { text: "..." } or { error: "..." }
        if (response.data.error) {
            throw new Error(response.data.error);
        }
        
        console.log(`✅ ${apiConfig.name} success in ${responseTime}ms`);
        
        return {
            text: response.data.text,
            responseTime
        };
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error(`❌ ${apiConfig.name} failed:`, error.response?.data || error.message);
        
        // Handle specific HuggingFace errors
        if (error.response?.status === 503) {
            throw new Error('Model is loading, please retry in 20s');
        } else if (error.response?.status === 410) {
            throw new Error('Model is currently unavailable');
        }
        
        throw new Error(
            error.response?.data?.error || 
            error.message || 
            'HuggingFace API failed'
        );
    }
}

// ==============================================
// FAILOVER LOGIC
// ==============================================

async function transcribeWithFailover(audioBuffer, language) {
    const enabledApis = API_CONFIGS.filter(api => {
        const hasKey = api.enabled && api.apiKey;
        if (!hasKey) {
            console.log(`⚠️ Skipping ${api.name} - No API key or disabled`);
        }
        return hasKey;
    });
    
    if (enabledApis.length === 0) {
        throw new Error('No API keys configured. Please add API keys in .env file');
    }

    console.log(`🚀 Starting transcription with ${enabledApis.length} available APIs`);
    
    const attempts = [];
    let lastError = null;

    // Try each API
    for (let i = 0; i < enabledApis.length; i++) {
        const apiIndex = (currentApiIndex + i) % enabledApis.length;
        const apiConfig = enabledApis[apiIndex];
        
        const statsIndex = API_CONFIGS.findIndex(a => a.name === apiConfig.name);
        apiStats[statsIndex].totalRequests++;
        apiStats[statsIndex].lastUsed = new Date().toISOString();

        console.log(`\n🔄 Attempt ${i + 1}/${enabledApis.length}: ${apiConfig.name}`);

        try {
            let result;

            if (apiConfig.type === 'openai') {
                result = await callOpenAI(audioBuffer, language, apiConfig);
            } else if (apiConfig.type === 'huggingface') {
                result = await callHuggingFace(audioBuffer, language, apiConfig);
            } else {
                throw new Error(`Unknown API type: ${apiConfig.type}`);
            }

            // Success!
            apiStats[statsIndex].successfulRequests++;
            apiStats[statsIndex].averageResponseTime = result.responseTime;
            apiStats[statsIndex].lastError = null;
            
            // Move to next API for load balancing
            currentApiIndex = (apiIndex + 1) % enabledApis.length;

            console.log(`\n✅ SUCCESS with ${apiConfig.name}!`);
            console.log(`📊 Total attempts: ${i + 1}`);

            return {
                text: result.text,
                apiUsed: apiConfig.name,
                attempts: i + 1,
                responseTime: result.responseTime
            };

        } catch (error) {
            lastError = error;
            apiStats[statsIndex].failedRequests++;
            apiStats[statsIndex].lastError = error.message;

            attempts.push({
                api: apiConfig.name,
                error: error.message
            });

            console.log(`❌ ${apiConfig.name} failed: ${error.message}`);
            
            // Continue to next API
            if (i < enabledApis.length - 1) {
                console.log(`⏭️ Trying next API...`);
            }
        }
    }

    // All APIs failed
    console.error('\n❌ ALL APIs FAILED');
    console.error('Attempts:', JSON.stringify(attempts, null, 2));
    
    throw new Error(`All ${enabledApis.length} APIs failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

// ==============================================
// ENDPOINTS
// ==============================================

// Main transcription endpoint
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    console.log('\n' + '='.repeat(50));
    console.log('🎤 NEW TRANSCRIPTION REQUEST');
    console.log('='.repeat(50));
    
    try {
        if (!req.file) {
            console.error('❌ No audio file provided');
            return res.status(400).json({ error: 'No audio file provided' });
        }

        console.log(`📁 File size: ${(req.file.size / 1024).toFixed(2)} KB`);
        console.log(`📝 File type: ${req.file.mimetype}`);
        
        const language = req.body.language || 'en';
        console.log(`🌍 Language: ${language}`);
        
        const audioBuffer = req.file.buffer;

        const result = await transcribeWithFailover(audioBuffer, language);

        console.log('\n✅ TRANSCRIPTION SUCCESSFUL');
        console.log(`📝 Text length: ${result.text.length} characters`);
        console.log(`⚡ Response time: ${result.responseTime}ms`);
        console.log(`🔧 API used: ${result.apiUsed}`);
        
        res.json({
            success: true,
            text: result.text,
            apiUsed: result.apiUsed,
            attempts: result.attempts,
            responseTime: result.responseTime
        });

    } catch (error) {
        console.error('\n❌ TRANSCRIPTION FAILED');
        console.error('Error:', error.message);
        
        res.status(500).json({ 
            success: false,
            error: error.message || 'Transcription failed',
            details: 'All configured APIs failed. Please check your API keys and try again.'
        });
    }
});

// Get API statistics
app.get('/api/stats', (req, res) => {
    const enabledApis = API_CONFIGS.filter(api => api.enabled && api.apiKey);
    
    res.json({
        success: true,
        totalApis: API_CONFIGS.length,
        enabledApis: enabledApis.length,
        currentApiIndex,
        stats: apiStats,
        apiConfigs: API_CONFIGS.map(api => ({
            name: api.name,
            type: api.type,
            enabled: api.enabled,
            hasApiKey: !!api.apiKey,
            priority: api.priority
        }))
    });
});

// Reset statistics
app.post('/api/reset-stats', (req, res) => {
    apiStats = API_CONFIGS.map(api => ({
        name: api.name,
        type: api.type,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        lastUsed: null,
        lastError: null,
        averageResponseTime: 0
    }));
    currentApiIndex = 0;
    
    console.log('📊 Stats reset');
    res.json({ success: true, message: 'Stats reset successfully' });
});

// Health check
app.get('/health', (req, res) => {
    const enabledApis = API_CONFIGS.filter(api => api.enabled && api.apiKey);
    res.json({ 
        success: true,
        status: 'ok',
        enabledApis: enabledApis.length,
        totalApis: API_CONFIGS.length,
        apis: enabledApis.map(api => api.name)
    });
});

// Test endpoint
app.get('/test', (req, res) => {
    res.json({ 
        success: true,
        message: 'Server is running!',
        timestamp: new Date().toISOString()
    });
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        success: false,
        error: 'Endpoint not found',
        availableEndpoints: [
            'POST /api/transcribe',
            'GET /api/stats',
            'POST /api/reset-stats',
            'GET /health',
            'GET /test'
        ]
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        success: false,
        error: err.message || 'Internal server error'
    });
});

// ==============================================
// START SERVER
// ==============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 VOICE TO TEXT SERVER STARTED');
    console.log('='.repeat(60));
    console.log(`📡 Server running on: http://localhost:${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    
    const enabledApis = API_CONFIGS.filter(api => api.enabled && api.apiKey);
    console.log(`\n📊 API Configuration:`);
    console.log(`   Total APIs: ${API_CONFIGS.length}`);
    console.log(`   Enabled APIs: ${enabledApis.length}`);
    console.log(`   Configured APIs:`);
    
    enabledApis.forEach((api, index) => {
        console.log(`      ${index + 1}. ${api.name} (${api.type})`);
    });
    
    if (enabledApis.length === 0) {
        console.log('\n⚠️  WARNING: No API keys configured!');
        console.log('   Please add API keys to your .env file');
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Ready to transcribe! 🎤');
    console.log('='.repeat(60) + '\n');
});
