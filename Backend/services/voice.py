import speech_recognition as sr
import threading
import logging
import asyncio

class VoiceEngine:
    def __init__(self):
        self.recognizer = sr.Recognizer()
        self.is_listening = False
        self.stop_listening_func = None
        self.wakeup_event = threading.Event()
        self.lock = threading.Lock()

    def start(self):
        with self.lock:
            if self.is_listening:
                return
            try:
                # We initialize the mic inside to grab the device
                self.microphone = sr.Microphone()
                with self.microphone as source:
                    self.recognizer.adjust_for_ambient_noise(source, duration=1)
                
                self.stop_listening_func = self.recognizer.listen_in_background(
                    self.microphone, 
                    self._callback
                )
                self.is_listening = True
                logging.info("VoiceEngine started listening for wake word.")
            except Exception as e:
                logging.error(f"Failed to start VoiceEngine: {e}")

    def stop(self):
        with self.lock:
            if self.is_listening and self.stop_listening_func:
                self.stop_listening_func(wait_for_stop=False)
                self.is_listening = False
                logging.info("VoiceEngine stopped.")

    def _callback(self, recognizer, audio):
        try:
            # Quick lightweight transcription for wake word
            text = recognizer.recognize_google(audio).lower()
            if "tars" in text or "tar" in text or "cars" in text or "stars" in text:
                logging.info(f"Wake word detected in: '{text}'")
                self.wakeup_event.set()
        except sr.UnknownValueError:
            pass
        except sr.RequestError as e:
            logging.error(f"Speech recognition error: {e}")

voice_engine = VoiceEngine()
