import speech_recognition as sr
import threading
import logging
import sounddevice as sd
import time

class VoiceEngine:
    def __init__(self):
        self.recognizer = sr.Recognizer()
        self.is_listening = False
        self.wakeup_event = threading.Event()
        self.lock = threading.Lock()
        self.thread = None

    def _process_audio(self, raw_audio, samplerate):
        audio = sr.AudioData(raw_audio, samplerate, 2)
        try:
            text = self.recognizer.recognize_google(audio).lower()
            if "tars" in text or "tar" in text or "cars" in text or "stars" in text:
                logging.info(f"Wake word detected in: '{text}'")
                self.wakeup_event.set()
        except sr.UnknownValueError:
            pass
        except sr.RequestError as e:
            logging.error(f"Speech recognition error: {e}")

    def _listen_loop(self):
        samplerate = 16000
        while self.is_listening:
            try:
                duration = 2.5 
                # Listen in 2.5 second blocks
                audio_data = sd.rec(int(samplerate * duration), samplerate=samplerate, channels=1, dtype='int16')
                sd.wait()
                
                if not self.is_listening:
                    break
                    
                raw_audio = audio_data.tobytes()
                # Process audio in a non-blocking thread so we can keep listening
                threading.Thread(target=self._process_audio, args=(raw_audio, samplerate), daemon=True).start()
            except Exception as e:
                logging.error(f"VoiceEngine loop error: {e}")
                time.sleep(1)

    def start(self):
        with self.lock:
            if self.is_listening:
                return
            self.is_listening = True
            self.thread = threading.Thread(target=self._listen_loop, daemon=True)
            self.thread.start()
            logging.info("VoiceEngine started listening for wake word using sounddevice.")

    def stop(self):
        with self.lock:
            self.is_listening = False
            logging.info("VoiceEngine stopped.")

voice_engine = VoiceEngine()
