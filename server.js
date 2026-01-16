const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Serve static files
app.use(express.static('.'));
app.use(express.json());

// ==============================================
// MULTIPLE API CONFIGURATION
// ==============================================

const API_CONFIGS = [
    // 1. OpenAI Whisper API
    {
        name: 'OpenAI-1',
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY_1,
        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
        enabled: true,
        priority: 1
    },
    
    // 2. OpenAI Whisper API (Account 2)
    {
        name: 'OpenAI-2',
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY_2,
        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
        enabled: true,
        priority: 2
    },
    
    // 3. OpenAI Whisper API (Account 3)
    {
        name: 'OpenAI-3',
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY_3,
        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
        enabled: true,
        priority: 3
    },
    
    // 4. OpenAI Whisper API (Account 4)
    {
        name: 'OpenAI-4',
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY_4,
        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
        enabled: true,
        priority: 4
    },
    
    // 5. Gemini API (Account 1)
    {
        name: 'Gemini-1',
        type: 'gemini',
        apiKey: process.env.GEMINI_API_KEY_1,
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
        enabled: true,
        priority: 5
    },
    
    // 6. Gemini API (Account 2)
    {
        name: 'Gemini-2',
        type: 'gemini',
        apiKey: process.env.GEMINI_API_KEY_2,
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
        enabled: true,
        priority: 6
    },
    
    // 7. Gemini API (Account 3)
    {
        name: 'Gemini-3',
        type: 'gemini',
        apiKey: process.env.GEMINI_API_KEY_3,
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
        enabled: true,
        priority: 7
    },
    
    // 8. HuggingFace API
    {
        name: 'HuggingFace-1',
        type: 'huggingface',
        apiKey: process.env.HUGGINGFACE_API_KEY_1,
        endpoint: 'https://api-inference.huggingface.co/models/openai/whisper-large-v3',
        enabled: true,
        priority: 8
    }
];

// Track API usage
let currentApiIndex = 0;
let apiStats = API_CONFIGS.map(api => ({
    name: api.name,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    lastUsed: null,
    lastError: null
}));

// ==============================================
// API CALL FUNCTIONS
// ==============================================

async function callOpenAI(audioBuffer, language, apiConfig) {
    const formData = new FormData();
    formData.append('file', audioBuffer, {
        filename: 'audio.webm',
        contentType: 'audio/webm'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', language);

    const response = await axios.post(
        apiConfig.endpoint,
        formData,
        {
            headers: {
                'Authorization': `Bearer ${apiConfig.apiKey}`,
                ...formData.getHeaders()
            },
            timeout: 30000
        }
    );

    return response.data.text;
}

async function callGemini(audioBuffer, language, apiConfig) {
    // Gemini doesn't directly support audio transcription
    // This is a placeholder - you'd need to use Google Cloud Speech-to-Text instead
    // For now, we'll skip Gemini for audio transcription
    
    throw new Error('Gemini API does not support direct audio transcription. Use Google Cloud Speech-to-Text instead.');
}

async function callHuggingFace(audioBuffer, language, apiConfig) {
    const response = await axios.post(
        apiConfig.endpoint,
        audioBuffer,
        {
            headers: {
                'Authorization': `Bearer ${apiConfig.apiKey}`,
                'Content-Type': 'audio/webm'
            },
            timeout: 60000 // HuggingFace can be slow
        }
    );

    // HuggingFace Whisper returns: { text: "..." }
    return response.data.text;
}

async function callDeepgram(audioBuffer, language, apiConfig) {
    const response = await axios.post(
        `${apiConfig.endpoint}?language=${language}`,
        audioBuffer,
        {
            headers: {
                'Authorization': `Token ${apiConfig.apiKey}`,
                'Content-Type': 'audio/webm'
            },
            timeout: 30000
        }
    );

    return response.data.results.channels[0].alternatives[0].transcript;
}

async function callAssemblyAI(audioBuffer, language, apiConfig) {
    // Step 1: Upload audio
    const uploadResponse = await axios.post(
        'https://api.assemblyai.com/v2/upload',
        audioBuffer,
        {
            headers: {
                'authorization': apiConfig.apiKey,
                'Content-Type': 'audio/webm'
            }
        }
    );

    const audioUrl = uploadResponse.data.upload_url;

    // Step 2: Request transcription
    const transcriptResponse = await axios.post(
        'https://api.assemblyai.com/v2/transcript',
        {
            audio_url: audioUrl,
            language_code: language
        },
        {
            headers: {
                'authorization': apiConfig.apiKey,
                'Content-Type': 'application/json'
            }
        }
    );

    const transcriptId = transcriptResponse.data.id;

    // Step 3: Poll for completion
    let transcript;
    while (true) {
        const pollingResponse = await axios.get(
            `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
            {
                headers: {
                    'authorization': apiConfig.apiKey
                }
            }
        );

        if (pollingResponse.data.status === 'completed') {
            transcript = pollingResponse.data.text;
            break;
        } else if (pollingResponse.data.status === 'error') {
            throw new Error('Transcription failed');
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return transcript;
}

// ==============================================
// MAIN TRANSCRIPTION FUNCTION WITH FAILOVER
// ==============================================

async function transcribeWithFailover(audioBuffer, language) {
    const enabledApis = API_CONFIGS.filter(api => api.enabled && api.apiKey);
    
    if (enabledApis.length === 0) {
        throw new Error('No API keys configured');
    }

    const attempts = [];
    let lastError = null;

    // Try each API in round-robin fashion
    for (let i = 0; i < enabledApis.length; i++) {
        const apiIndex = (currentApiIndex + i) % enabledApis.length;
        const apiConfig = enabledApis[apiIndex];
        
        // Update stats
        const statsIndex = API_CONFIGS.findIndex(a => a.name === apiConfig.name);
        apiStats[statsIndex].totalRequests++;
        apiStats[statsIndex].lastUsed = new Date().toISOString();

        console.log(`🔄 Trying API ${i + 1}/${enabledApis.length}: ${apiConfig.name}`);

        try {
            let text;

            switch (apiConfig.type) {
                case 'openai':
                    text = await callOpenAI(audioBuffer, language, apiConfig);
                    break;
                case 'gemini':
                    text = await callGemini(audioBuffer, language, apiConfig);
                    break;
                case 'huggingface':
                    text = await callHuggingFace(audioBuffer, language, apiConfig);
                    break;
                case 'deepgram':
                    text = await callDeepgram(audioBuffer, language, apiConfig);
                    break;
                case 'assemblyai':
                    text = await callAssemblyAI(audioBuffer, language, apiConfig);
                    break;
                default:
                    throw new Error(`Unknown API type: ${apiConfig.type}`);
            }

            // Success!
            apiStats[statsIndex].successfulRequests++;
            currentApiIndex = (apiIndex + 1) % enabledApis.length; // Move to next API for load balancing

            console.log(`✅ Success with ${apiConfig.name}`);

            return {
                text,
                apiUsed: apiConfig.name,
                attempts: attempts.length + 1
            };

        } catch (error) {
            lastError = error;
            apiStats[statsIndex].failedRequests++;
            apiStats[statsIndex].lastError = error.message;

            attempts.push({
                api: apiConfig.name,
                error: error.message
            });

            console.log(`❌ Failed with ${apiConfig.name}: ${error.message}`);

            // Continue to next API
        }
    }

    // All APIs failed
    throw new Error(`All APIs failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

// ==============================================
// ENDPOINTS
// ==============================================

// Main transcription endpoint
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        const language = req.body.language || 'en';
        const audioBuffer = req.file.buffer;

        const result = await transcribeWithFailover(audioBuffer, language);

        res.json({
            text: result.text,
            apiUsed: result.apiUsed,
            attempts: result.attempts
        });

    } catch (error) {
        console.error('Transcription error:', error);
        res.status(500).json({ 
            error: error.message || 'All transcription APIs failed'
        });
    }
});

// Get API stats
app.get('/api/stats', (req, res) => {
    const enabledApis = API_CONFIGS.filter(api => api.enabled && api.apiKey);
    
    res.json({
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

// Health check
app.get('/health', (req, res) => {
    const enabledApis = API_CONFIGS.filter(api => api.enabled && api.apiKey);
    res.json({ 
        status: 'ok',
        enabledApis: enabledApis.length,
        totalApis: API_CONFIGS.length
    });
});

// Reset stats
app.post('/api/reset-stats', (req, res) => {
    apiStats = API_CONFIGS.map(api => ({
        name: api.name,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        lastUsed: null,
        lastError: null
    }));
    currentApiIndex = 0;
    res.json({ message: 'Stats reset successfully' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Enabled APIs: ${API_CONFIGS.filter(api => api.enabled && api.apiKey).length}/${API_CONFIGS.length}`);
});
