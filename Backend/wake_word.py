import sys
import time
import threading

print("TARS Wake-Word Background Process Started.", file=sys.stderr)
sys.stderr.flush()

HAS_SR = False
HAS_SD = False
try:
    import speech_recognition as sr
    HAS_SR = True
except ImportError:
    pass

try:
    import sounddevice as sd
    import numpy as np
    HAS_SD = True
except ImportError:
    pass

if not (HAS_SR and HAS_SD):
    print("\n[WAKE-WORD INFO] 'speech_recognition' or 'sounddevice' package not found.", file=sys.stderr)
    print("To enable real microphone listening, run:", file=sys.stderr)
    print("    uv pip install SpeechRecognition sounddevice numpy", file=sys.stderr)
    print("Using interactive keyboard fallback mode for testing.", file=sys.stderr)
    sys.stderr.flush()

# Interactive Console Thread (fallback/manual trigger)
def keyboard_listener():
    print("\n[KEYBOARD FALLBACK] Hitting ENTER in this console will trigger WAKE event manually.", file=sys.stderr)
    sys.stderr.flush()
    while True:
        try:
            sys.stdin.readline()
            print("WAKE")
            sys.stdout.flush()
            print("[KEYBOARD TRIGGER] WAKE command sent to Electron.", file=sys.stderr)
            sys.stderr.flush()
        except Exception as e:
            print(f"Stdin listener stopped: {e}", file=sys.stderr)
            break

def mic_listener():
    r = sr.Recognizer()
    samplerate = 16000
    duration = 3.0
    
    print(f"[WAKE-WORD] Listening for 'HEY TARS' using sounddevice ({duration}s chunks)...", file=sys.stderr)
    sys.stderr.flush()

    while True:
        try:
            # Capture audio snippet
            audio_data = sd.rec(int(samplerate * duration), samplerate=samplerate, channels=1, dtype='int16')
            sd.wait()
            raw_audio = audio_data.tobytes()
            audio = sr.AudioData(raw_audio, samplerate, 2)
            
            # Use Google Speech Recognition
            text = r.recognize_google(audio).lower()
            print(f"[WAKE-WORD DETECTED] Speech audio: '{text}'", file=sys.stderr)
            sys.stderr.flush()
            
            if "tars" in text or "hey tars" in text or "taars" in text or "stars" in text:
                print("WAKE")
                sys.stdout.flush()
                print("[WAKE-WORD MATCH] 'HEY TARS' spotted! WAKE command sent to Electron.", file=sys.stderr)
                sys.stderr.flush()
                
        except sr.UnknownValueError:
            # Speech was heard but could not be parsed into words
            continue
        except sr.RequestError as e:
            print(f"[WAKE-WORD WARNING] Speech recognition service error: {e}", file=sys.stderr)
            sys.stderr.flush()
            time.sleep(2)
        except Exception as e:
            print(f"[WAKE-WORD ERROR] Unexpected error: {e}", file=sys.stderr)
            sys.stderr.flush()
            time.sleep(1)

if __name__ == "__main__":
    # Start keyboard listener in a daemon thread so it can always trigger WAKE
    kb_thread = threading.Thread(target=keyboard_listener, daemon=True)
    kb_thread.start()

    # Start mic listener if packages are present
    if HAS_SR and HAS_SD:
        mic_listener()
    else:
        # Keep main thread alive for keyboard fallback
        while True:
            time.sleep(1)
