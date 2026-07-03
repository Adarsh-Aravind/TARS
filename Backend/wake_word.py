import sys
import time
import threading

print("TARS Wake-Word Background Process Started.", file=sys.stderr)
sys.stderr.flush()

HAS_SR = False
try:
    import speech_recognition as sr
    HAS_SR = True
except ImportError:
    print("\n[WAKE-WORD INFO] 'speech_recognition' package not found.", file=sys.stderr)
    print("To enable real microphone listening, run:", file=sys.stderr)
    print("    pip install SpeechRecognition pyaudio", file=sys.stderr)
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
    mic = None
    
    try:
        mic = sr.Microphone()
        # Adjust for ambient noise
        with mic as source:
            print("[WAKE-WORD] Calibrating microphone noise threshold...", file=sys.stderr)
            sys.stderr.flush()
            r.adjust_for_ambient_noise(source, duration=1)
        print("[WAKE-WORD] Microphone calibration complete. Listening for 'HEY TARS'...", file=sys.stderr)
        sys.stderr.flush()
    except Exception as e:
        print(f"\n[WAKE-WORD ERROR] Failed to initialize microphone: {e}", file=sys.stderr)
        print("Falling back to interactive keyboard trigger.", file=sys.stderr)
        sys.stderr.flush()
        return False

    while True:
        try:
            with mic as source:
                # Capture audio snippet (timeout ensures we don't block indefinitely if no speech)
                audio = r.listen(source, timeout=5, phrase_time_limit=3)
            
            # Use Google Speech Recognition (free, offline/online fallback)
            text = r.recognize_google(audio).lower()
            print(f"[WAKE-WORD DETECTED] Speech audio: '{text}'", file=sys.stderr)
            sys.stderr.flush()
            
            if "tars" in text or "hey tars" in text or "taars" in text or "stars" in text:
                print("WAKE")
                sys.stdout.flush()
                print("[WAKE-WORD MATCH] 'HEY TARS' spotted! WAKE command sent to Electron.", file=sys.stderr)
                sys.stderr.flush()
                
        except sr.WaitTimeoutError:
            # Simple timeout when no audio is heard - just loop again
            continue
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
    if HAS_SR:
        success = mic_listener()
        if not success:
            # If mic listener failed to start, just keep main thread alive for keyboard
            while True:
                time.sleep(1)
    else:
        # Keep main thread alive for keyboard fallback
        while True:
            time.sleep(1)
