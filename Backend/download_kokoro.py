import os
import urllib.request

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/kokoro-v0_19.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/voices.json"

MODEL_PATH = "kokoro-v0_19.onnx"
VOICES_PATH = "voices.json"

def download_file(url, dest):
    if not os.path.exists(dest):
        print(f"Downloading {dest} from {url}...")
        urllib.request.urlretrieve(url, dest)
        print(f"Downloaded {dest}")
    else:
        print(f"{dest} already exists.")

if __name__ == "__main__":
    download_file(MODEL_URL, MODEL_PATH)
    download_file(VOICES_URL, VOICES_PATH)
    print("Download complete.")
