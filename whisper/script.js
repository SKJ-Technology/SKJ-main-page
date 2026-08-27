// State management
let downloadStates = {};
let pipelines = {};
let activeModel = null;
let lastRecognizedText = '';
let audioStream = null;
let audioContext = null;
let isListening = false;
let audioBuffer = [];
let animationFrame = null;
let currentDownloadPromise = null;
let abortController = null;
let deferredPrompt; // For PWA installation

// DOM Elements
const modelSelect = document.getElementById('modelSelect');
const downloadBtn = document.getElementById('downloadBtn');
const cancelDownloadBtn = document.getElementById('cancelDownloadBtn');
const runBtn = document.getElementById('runBtn');
const stopBtn = document.getElementById('stopBtn');
const deleteBtn = document.getElementById('deleteBtn');
const downloadStatus = document.getElementById('downloadStatus');
const recognizedText = document.getElementById('recognizedText');
const audioVisualizer = document.getElementById('audioVisualizer');
const canvasCtx = audioVisualizer.getContext('2d');

// PWA Installation handling
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    // Show install button (you can add UI here if needed)
    console.log('PWA ready for installation');
});

// Initialize transformers library
let pipeline = null;

async function loadTransformers() {
    if (!pipeline) {
        const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
        pipeline = mod.pipeline;
        mod.env.allowLocalModels = false;
    }
}

// Button event handlers
downloadBtn.addEventListener('click', () => {
    const modelId = modelSelect.value;
    downloadModel(modelId);
});

cancelDownloadBtn.addEventListener('click', () => {
    cancelDownload();
});

runBtn.addEventListener('click', () => {
    const modelId = modelSelect.value;
    runModel(modelId);
});

stopBtn.addEventListener('click', () => {
    stopModel();
});

deleteBtn.addEventListener('click', () => {
    const modelId = modelSelect.value;
    deleteModel(modelId);
});

// Model operations
async function downloadModel(modelId) {
    if (pipelines[modelId]) {
        downloadStates[modelId] = 'Pobrane';
        updateDownloadStatus();
        return;
    }

    try {
        downloadStates[modelId] = 'Inicjalizacja...';
        updateDownloadStatus();
        
        await loadTransformers();

        // Create AbortController for cancellation
        abortController = new AbortController();
        
        currentDownloadPromise = pipeline('automatic-speech-recognition', modelId, {
            quantized: true,
            progress_callback: (progress) => {
                // Check if cancelled
                if (abortController.signal.aborted) {
                    return;
                }
                
                if (progress.status === 'progress') {
                    const file = progress.file || '';
                    const percent = Math.round(progress.progress || 0);
                    downloadStates[modelId] = `Pobieranie ${percent}% (${file})`;
                } else if (progress.status === 'done') {
                    downloadStates[modelId] = 'Przetwarzanie...';
                }
                updateDownloadStatus();
            },
            signal: abortController.signal
        });

        const p = await currentDownloadPromise;
        pipelines[modelId] = p;
        downloadStates[modelId] = 'Pobrane';
        updateDownloadStatus();
    } catch (e) {
        // Handle abort error separately
        if (e.name === 'AbortError') {
            downloadStates[modelId] = 'Pobieranie anulowane';
        } else {
            console.error('Błąd pobierania Whisper:', e);
            downloadStates[modelId] = `Błąd: ${e.message || 'Nieznany błąd'}`;
        }
        updateDownloadStatus();
    } finally {
        currentDownloadPromise = null;
        abortController = null;
    }
}

function cancelDownload() {
    if (abortController) {
        abortController.abort();
        const modelId = modelSelect.value;
        downloadStates[modelId] = 'Pobieranie anulowane';
        updateDownloadStatus();
    }
}

async function runModel(modelId) {
    if (!modelId || !pipelines[modelId]) {
        console.warn(`Model ${modelId} nie jest pobrany!`);
        downloadStatus.textContent = `Model ${modelId} nie jest pobrany!`;
        return;
    }

    activeModel = modelId;
    isListening = true;
    startListening();
    downloadStatus.textContent = `Uruchomiono model: ${modelId}`;
}

async function startListening() {
    if (audioStream) return;
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(audioStream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        audioBuffer = [];

        processor.onaudioprocess = async (e) => {
            if (!isListening || !activeModel) return;
            const inputData = e.inputBuffer.getChannelData(0);
            audioBuffer.push(...inputData);

            // Visualize audio data
            visualizeAudio(inputData);

            // Process approximately 3-second samples (16000 Hz * 3)
            if (audioBuffer.length >= 48000) {
                const samples = new Float32Array(audioBuffer);
                audioBuffer = [];

                const transcriber = pipelines[activeModel];
                if (transcriber) {
                    try {
                        const output = await transcriber(samples);
                        if (output && output.text) {
                            lastRecognizedText = output.text.trim();
                            recognizedText.textContent = lastRecognizedText;
                        }
                    } catch (err) {
                        console.error('Błąd transkrypcji:', err);
                    }
                }
            }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
    } catch (err) {
        console.error('Błąd mikrofonu:', err);
        downloadStatus.textContent = `Błąd mikrofonu: ${err.message}`;
    }
}

function stopModel() {
    isListening = false;
    activeModel = null;
    
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
    
    downloadStatus.textContent = 'Model zatrzymany';
    clearVisualization();
}

function deleteModel(modelId) {
    if (!modelId) return;

    if (activeModel === modelId) {
        stopModel();
    }

    delete pipelines[modelId];
    delete downloadStates[modelId];
    
    downloadStatus.textContent = `Model ${modelId} usunięty`;
}

function updateDownloadStatus() {
    const modelId = modelSelect.value;
    downloadStatus.textContent = downloadStates[modelId] || 'Brak pobierania';
}

// Audio visualization
function visualizeAudio(data) {
    canvasCtx.clearRect(0, 0, audioVisualizer.width, audioVisualizer.height);
    
    canvasCtx.beginPath();
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = '#4C6EF5';
    
    const sliceWidth = audioVisualizer.width / data.length;
    let x = 0;
    
    for (let i = 0; i < data.length; i++) {
        const v = data[i] * 100; // Amplify waveform
        const y = audioVisualizer.height / 2 + v;
        
        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
        
        x += sliceWidth;
    }
    
    canvasCtx.stroke();
}

function clearVisualization() {
    canvasCtx.clearRect(0, 0, audioVisualizer.width, audioVisualizer.height);
}

// Initialize
updateDownloadStatus();
