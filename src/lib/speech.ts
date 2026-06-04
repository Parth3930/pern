import { useState, useEffect, useRef, useCallback } from "react";

// Check if SpeechRecognition is supported
const SpeechRecognition =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

// Programmatic audio synthesis using Web Audio API (0 KB package size overhead)
export async function playBeep(type: "wake" | "listening" | "error" = "wake") {
  try {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "wake") {
      // Double beep (low to high)
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.start();
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === "listening") {
      // Simple friendly prompt beep
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.stop(ctx.currentTime + 0.1);
    } else if (type === "error") {
      // Low alert beep
      osc.type = "triangle";
      osc.frequency.setValueAtTime(220, ctx.currentTime); // A3
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.start();
      osc.frequency.linearRampToValueAtTime(110, ctx.currentTime + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.stop(ctx.currentTime + 0.25);
    }
  } catch (e) {
    console.warn("[SPEECH] Programmatic beep failed:", e);
  }
}

// Find a friendly, natural English voice pre-installed on the OS
export function getFriendlyVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  const enVoices = voices.filter((v) => v.lang.startsWith("en"));
  if (enVoices.length === 0) return voices[0];

  const priorities = [
    /google.*en-us/i,       // Android / Chrome High-Quality Google English
    /natural/i,             // Edge Natural voices (very friendly)
    /zira/i,                // Windows clear female
    /david/i,               // Windows clear male
    /hazel/i,               // Windows UK English
    /google/i,              // Any Google-powered voice
    /microsoft/i,           // Any Microsoft-powered voice
  ];

  for (const regex of priorities) {
    const match = enVoices.find((v) => regex.test(v.name));
    if (match) return match;
  }

  // Fallbacks
  const enUS = enVoices.find((v) => v.lang === "en-US");
  if (enUS) return enUS;

  return enVoices[0];
}

// List of words that sound like "pern" to allow fuzzy/robust wake-word detection
const WAKE_WORDS_PERN = [
  "pern",
  "burn",
  "fern",
  "pear",
  "perry",
  "parent",
  "pen",
  "plan",
  "firm",
  "porn",
  "phone",
  "person",
  "pearl",
  "turn",
  "learn",
  "born",
  "pan",
  "pin",
  "print",
  "pain",
  "point",
  "play pern",
  "hey pern",
  "hey burn",
  "hi pern",
  "ok pern",
  "****",
  "***"
];

// List of words that sound like "agent" to allow fuzzy/robust wake-word detection
const WAKE_WORDS_AGENT = [
  "agent",
  "gent",
  "asia",
  "asian",
  "aging",
  "urgent",
  "agenda",
  "legend",
  "engine",
  "ancient",
  "action",
  "a gent",
  "gentle",
  "edit",
  "region",
  "attention",
  "page",
  "play agent",
  "hey agent",
  "hi agent",
  "ok agent",
  "hello agent"
];

const WAKE_WORDS_BOTH = [...WAKE_WORDS_PERN, ...WAKE_WORDS_AGENT];

function getMatchedWakeWord(text: string): string | null {
  const normalized = text.toLowerCase();
  const keywordConfig = typeof localStorage !== "undefined" ? localStorage.getItem("pern_wakeword_keyword") || "both" : "both";

  let listToCheck = WAKE_WORDS_BOTH;
  if (keywordConfig === "pern") {
    listToCheck = WAKE_WORDS_PERN;
  } else if (keywordConfig === "agent") {
    listToCheck = WAKE_WORDS_AGENT;
  }

  // Find the longest matching word first to avoid partial matches
  const sortedList = [...listToCheck].sort((a, b) => b.length - a.length);

  for (const word of sortedList) {
    if (word.includes("*")) {
      if (normalized.includes(word)) return word;
    } else {
      const regex = new RegExp(`\\b${word}\\b`, "i");
      if (regex.test(normalized)) {
        return word;
      }
    }
  }
  return null;
}

function extractCommandAfterWakeWord(text: string, matchedWord: string): string | null {
  const normalizedText = text.toLowerCase();
  
  let index = -1;
  let wordLength = matchedWord.length;

  if (matchedWord.includes("*")) {
    index = normalizedText.indexOf(matchedWord);
  } else {
    const regex = new RegExp(`\\b${matchedWord}\\b`, "i");
    const match = regex.exec(text);
    if (match) {
      index = match.index;
      wordLength = match[0].length;
    }
  }

  if (index === -1) return null;

  const afterWord = text.slice(index + wordLength).trim();
  
  // Clean up leading fillers like "and", "to", "please", "do", "can you", "could you" and punctuation
  let command = afterWord.replace(/^[,.\s!?]+/, "");
  command = command.replace(/^(and|to|please|do|can you|could you)\b/i, "").trim();
  command = command.replace(/^[,.\s!?]+/, "");
  
  return command.length > 0 ? command : null;
}



interface UseSpeechProps {
  onCommandDetected?: (command: string) => void;
}

export function useSpeech({ onCommandDetected }: UseSpeechProps = {}) {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isWakeWordListening, setIsWakeWordListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceList, setVoiceList] = useState<SpeechSynthesisVoice[]>([]);

  const wakeWordRecRef = useRef<any>(null);
  const activeRecRef = useRef<any>(null);
  const ttsSpeakingRef = useRef<boolean>(false);
  
  // Settings preferences (synced to local storage)
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    const val = localStorage.getItem("pern_tts_enabled");
    return val === null ? true : val === "true"; // default true
  });
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() => {
    const val = localStorage.getItem("pern_wakeword_enabled");
    return val === null ? false : val === "true"; // default false (opt-in)
  });

  // Sync settings to localStorage
  useEffect(() => {
    localStorage.setItem("pern_tts_enabled", String(ttsEnabled));
  }, [ttsEnabled]);

  useEffect(() => {
    localStorage.setItem("pern_wakeword_enabled", String(wakeWordEnabled));
  }, [wakeWordEnabled]);

  // Check support and load voices
  useEffect(() => {
    if (SpeechRecognition) {
      setIsSupported(true);
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
      const updateVoices = () => {
        setVoiceList(window.speechSynthesis.getVoices());
      };
      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  // Speak text using SpeechSynthesis
  const speak = useCallback(
    (text: string) => {
      if (!ttsEnabled || typeof window === "undefined" || !window.speechSynthesis) return;

      // Stop any current speech
      window.speechSynthesis.cancel();

      // Clean up markdown markers or tool JSON if any
      const cleanText = text
        .replace(/```[\s\S]*?```/g, "") // remove code blocks
        .replace(/`[^`]+`/g, "")       // remove inline code
        .replace(/[*#_\-\[\]()]/g, "") // remove markdown styling characters
        .trim();

      if (!cleanText) return;

      const utterance = new SpeechSynthesisUtterance(cleanText);
      const savedVoiceName = typeof localStorage !== "undefined" ? localStorage.getItem("pern_tts_voice") : null;
      let chosenVoice: SpeechSynthesisVoice | null = null;
      if (savedVoiceName && window.speechSynthesis) {
        const voices = window.speechSynthesis.getVoices();
        chosenVoice = voices.find((v) => v.name === savedVoiceName) || null;
      }
      if (!chosenVoice) {
        chosenVoice = getFriendlyVoice();
      }
      if (chosenVoice) {
        utterance.voice = chosenVoice;
      }

      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        setIsSpeaking(true);
        ttsSpeakingRef.current = true;
        
        // Temporarily pause wake word listening when speaking to avoid self-triggering
        if (wakeWordRecRef.current && isWakeWordListening) {
          wakeWordRecRef.current.abort();
        }
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        ttsSpeakingRef.current = false;
        
        // Resume wake word listening
        if (wakeWordEnabled && !isListening) {
          startWakeWordRecognition();
        }
      };

      utterance.onerror = (e) => {
        console.error("[SPEECH] TTS Speak error:", e);
        setIsSpeaking(false);
        ttsSpeakingRef.current = false;
        
        // Resume wake word listening
        if (wakeWordEnabled && !isListening) {
          startWakeWordRecognition();
        }
      };

      window.speechSynthesis.speak(utterance);
    },
    [ttsEnabled, wakeWordEnabled, isWakeWordListening, isListening]
  );

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      ttsSpeakingRef.current = false;
      
      // Resume wake word listening if enabled
      if (wakeWordEnabled && !isListening) {
        startWakeWordRecognition();
      }
    }
  }, [wakeWordEnabled, isListening]);

  // Start background listening for wake word "pern"
  const startWakeWordRecognition = useCallback(() => {
    if (!SpeechRecognition || !wakeWordEnabled) return;
    if (ttsSpeakingRef.current) {
      console.log("[SPEECH] Waiting to listen: TTS is currently speaking...");
      return;
    }

    if (wakeWordRecRef.current) {
      try {
        const oldRec = wakeWordRecRef.current;
        wakeWordRecRef.current = null; // Disconnect first so onend doesn't restart it
        oldRec.abort();
      } catch (e) {}
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onstart = () => {
      setIsWakeWordListening(true);
      const keywordConfig = typeof localStorage !== "undefined" ? localStorage.getItem("pern_wakeword_keyword") || "both" : "both";
      console.log(`[SPEECH] Wake-word listening active (keyword mode: '${keywordConfig}')...`);
    };

    rec.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          console.log("[SPEECH] Wake-word final transcript:", text);
          const matchedWord = getMatchedWakeWord(text);
          if (matchedWord) {
            const command = extractCommandAfterWakeWord(text, matchedWord);
            if (command) {
              console.log("[SPEECH] Continuous command detected from final:", command);
              stopWakeWordRecognition();
              if (onCommandDetected) {
                onCommandDetected(command);
              }
              return;
            } else {
              // Only wake word spoken, transition to active listening mode
              triggerActiveListening();
              return;
            }
          }
        }
      }
    };

    rec.onend = () => {
      // Only handle restart if this is still the active recognizer instance
      if (wakeWordRecRef.current === rec) {
        setIsWakeWordListening(false);
        if (wakeWordEnabled && !activeRecRef.current && !ttsSpeakingRef.current) {
          setTimeout(() => {
            if (wakeWordEnabled && wakeWordRecRef.current === rec && !activeRecRef.current && !ttsSpeakingRef.current) {
              startWakeWordRecognition();
            }
          }, 50);
        }
      } else {
        console.log("[SPEECH] Old wake-word listener instance cleaned up.");
      }
    };

    rec.onerror = (event: any) => {
      if (event.error === "no-speech") {
        console.log("[SPEECH] Wake-word engine: no speech detected, waiting to listen...");
      } else if (event.error === "aborted") {
        console.log("[SPEECH] Wake-word engine: programmatically aborted.");
      } else {
        console.warn("[SPEECH] Wake-word engine error:", event.error);
      }
    };

    wakeWordRecRef.current = rec;
    try {
      rec.start();
    } catch (e) {
      console.error("[SPEECH] Failed to start wake-word recognition:", e);
    }
  }, [wakeWordEnabled]);

  const stopWakeWordRecognition = useCallback(() => {
    if (wakeWordRecRef.current) {
      wakeWordRecRef.current.abort();
      wakeWordRecRef.current = null;
    }
    setIsWakeWordListening(false);
  }, []);

  // Start active, single-turn listening for a command
  const triggerActiveListening = useCallback(async () => {
    if (!SpeechRecognition) return;

    // Turn off wake-word recognizer while active listening is running
    stopWakeWordRecognition();
    stopSpeaking();

    await playBeep("wake");

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false; // We only need the final output
    rec.lang = "en-US";

    rec.onstart = () => {
      setIsListening(true);
      console.log("[SPEECH] Command listening active...");
    };

    rec.onresult = (event: any) => {
      const result = event.results[0]?.[0]?.transcript;
      if (result) {
        console.log("[SPEECH] Command detected:", result);
        if (onCommandDetected) {
          onCommandDetected(result);
        }
      }
    };

    rec.onend = () => {
      setIsListening(false);
      activeRecRef.current = null;
      // Re-enable wake-word listening if appropriate
      if (wakeWordEnabled) {
        setTimeout(() => {
          startWakeWordRecognition();
        }, 500);
      }
    };

    rec.onerror = (event: any) => {
      if (event.error === "no-speech") {
        console.log("[SPEECH] Active listening: no speech detected, waiting to listen...");
      } else if (event.error === "aborted") {
        console.log("[SPEECH] Active listening: programmatically aborted.");
      } else {
        console.warn("[SPEECH] Active listening error:", event.error);
      }
      setIsListening(false);
      activeRecRef.current = null;
      playBeep("error");
      
      if (wakeWordEnabled) {
        setTimeout(() => {
          startWakeWordRecognition();
        }, 500);
      }
    };

    activeRecRef.current = rec;
    try {
      rec.start();
    } catch (e) {
      console.error("[SPEECH] Failed to start active command listening:", e);
      setIsListening(false);
      activeRecRef.current = null;
    }
  }, [wakeWordEnabled, onCommandDetected, stopWakeWordRecognition, startWakeWordRecognition, stopSpeaking]);

  const stopActiveListening = useCallback(() => {
    if (activeRecRef.current) {
      activeRecRef.current.abort();
      activeRecRef.current = null;
    }
    setIsListening(false);
  }, []);

  // Handle updates to wakeWordEnabled state
  useEffect(() => {
    if (wakeWordEnabled) {
      startWakeWordRecognition();
    } else {
      stopWakeWordRecognition();
    }

    return () => {
      stopWakeWordRecognition();
    };
  }, [wakeWordEnabled, startWakeWordRecognition, stopWakeWordRecognition]);

  return {
    isSupported,
    isListening,
    isWakeWordListening,
    isSpeaking,
    ttsEnabled,
    wakeWordEnabled,
    voiceList,
    setTtsEnabled,
    setWakeWordEnabled,
    speak,
    stopSpeaking,
    startListening: triggerActiveListening,
    stopListening: stopActiveListening,
  };
}
