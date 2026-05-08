class VoiceController {
    constructor() {
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isListening = false;
        this.isMuted = false;
        this.onMoveCallback = null;
        this.onCommandCallback = null;
        this.onQueryCallback = null;
        
        this.initRecognition();
    }
    
    initRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.error('Speech recognition not supported');
            return;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';
        
        this.recognition.onresult = (event) => {
            const last = event.results.length - 1;
            const text = event.results[last][0].transcript;
            
            console.log('Recognized:', text);
            this.handleSpeech(text);
        };
        
        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            
            if (event.error === 'no-speech') {
                this.speak("I didn't hear you. Try again.");
            } else if (event.error === 'audio-capture') {
                this.speak("Microphone not found. Please check your settings.");
            } else if (event.error === 'not-allowed') {
                this.speak("Microphone permission denied.");
            }
        };
        
        this.recognition.onend = () => {
            // Auto-restart if we're supposed to be listening
            if (this.isListening) {
                this.recognition.start();
            }
        };
    }
    
    startListening() {
        if (!this.recognition) {
            this.speak("Voice recognition not available on this device.");
            return;
        }
        
        this.isListening = true;
        try {
            this.recognition.start();
        } catch (e) {
            // Already started
        }
    }
    
    stopListening() {
        this.isListening = false;
        if (this.recognition) {
            this.recognition.stop();
        }
    }
    
    speak(text, callback) {
        // Cancel any ongoing speech
        this.synthesis.cancel();
        
        // Update UI even if muted
        if (window.updateLastSpoken) {
            window.updateLastSpoken(text);
        }

        if (this.isMuted) {
            if (callback) callback();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;
        
        if (callback) {
            utterance.onend = callback;
        }
        
        this.synthesis.speak(utterance);
    }
    
    handleSpeech(text) {
        // Update UI
        if (window.updateRecognizedText) {
            window.updateRecognizedText(text);
        }
        
        // Parse the move/command
        if (window.moveParser) {
            const parsed = window.moveParser.parse(text);
            
            if (parsed.type === 'move' && this.onMoveCallback) {
                this.onMoveCallback(parsed);
            } else if (parsed.type === 'command' && this.onCommandCallback) {
                this.onCommandCallback(parsed);
            } else if (parsed.type === 'query' && this.onQueryCallback) {
                this.onQueryCallback(parsed);
            } else if (parsed.type === 'error') {
                this.speak(parsed.message);
            }
        }
    }
    
    setMoveCallback(callback) {
        this.onMoveCallback = callback;
    }
    
    setCommandCallback(callback) {
        this.onCommandCallback = callback;
    }
    
    setQueryCallback(callback) {
        this.onQueryCallback = callback;
    }
}