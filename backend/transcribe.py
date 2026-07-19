import argparse
import json
import os
import re
import sys
import warnings

# Suppress warnings
warnings.filterwarnings("ignore")

try:
    import imageio_ffmpeg
    import os
    import shutil
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg_dir = os.path.dirname(ffmpeg_exe)
    target_ffmpeg = os.path.join(ffmpeg_dir, "ffmpeg.exe")
    if not os.path.exists(target_ffmpeg):
        try:
            shutil.copy2(ffmpeg_exe, target_ffmpeg)
        except Exception:
            pass
    os.environ["PATH"] += os.pathsep + ffmpeg_dir
    
    # Add NVIDIA CUDA DLLs to path for CTranslate2
    import sys
    site_packages = os.path.join(sys.prefix, "Lib", "site-packages")
    nvidia_path = os.path.join(site_packages, "nvidia")
    cublas_bin = os.path.join(nvidia_path, "cublas", "bin")
    cudnn_bin = os.path.join(nvidia_path, "cudnn", "bin")
    
    if os.path.exists(cublas_bin):
        os.environ["PATH"] = cublas_bin + os.pathsep + os.environ["PATH"]
    if os.path.exists(cudnn_bin):
        os.environ["PATH"] = cudnn_bin + os.pathsep + os.environ["PATH"]
except Exception as e:
    pass

try:
    import stable_whisper
except ImportError:
    print("Error: stable-ts not installed. Please run setup.", file=sys.stderr)
    sys.exit(1)

def parse_args():
    parser = argparse.ArgumentParser(description="Ktv Premiere V2 Backend")
    parser.add_argument("--audio", required=True, help="Path to input audio file")
    parser.add_argument("--model", default="ivrit-ai/whisper-large-v3-turbo-ct2", help="Model name or path")
    parser.add_argument("--lang", default="he", help="Language code")
    parser.add_argument("--device", default="auto", help="cuda or cpu")
    parser.add_argument("--max-words", type=int, default=0, help="Max words per line")
    parser.add_argument("--translate", action="store_true", help="Translate to English")
    parser.add_argument("--dict", help="Path to personal dictionary JSON")
    parser.add_argument("--emoji", action="store_true", help="Enable Emoji generation")
    return parser.parse_args()

import difflib

def apply_fuzzy_dictionary(text, user_dict, threshold=0.60):
    if not user_dict:
        return text
    
    words = text.split()
    if not words:
        return text
        
    dict_words = sorted(user_dict, key=lambda x: len(x.split()), reverse=True)
    result = []
    
    i = 0
    while i < len(words):
        matched = False
        for dict_word in dict_words:
            dw_parts = dict_word.split()
            dw_len = len(dw_parts)
            
            if i + dw_len <= len(words):
                chunk_words = words[i:i+dw_len]
                clean_chunk = " ".join([w.strip(".,!?;:\"'()[]{}") for w in chunk_words])
                clean_dict = " ".join([w.strip(".,!?;:\"'()[]{}") for w in dw_parts])
                
                sim = difflib.SequenceMatcher(None, clean_chunk, clean_dict).ratio()
                
                if sim >= threshold:
                    prefixes = ('ב', 'ה', 'ו', 'כ', 'ל', 'מ', 'ש', 'וה', 'וכ', 'ול', 'ומ', 'וש', 'כב', 'כס')
                    first_orig = chunk_words[0]
                    first_dict = dw_parts[0]
                    
                    prefix = ""
                    if len(first_orig) > len(first_dict):
                        for p in prefixes:
                            if first_orig.startswith(p) and not clean_dict.startswith(p):
                                prefix = p
                                break
                    
                    replacement_parts = dw_parts[:]
                    replacement_parts[0] = prefix + replacement_parts[0]
                    
                    last_orig = chunk_words[-1]
                    suffix = ""
                    for char in reversed(last_orig):
                        if char in ".,!?;:\"'()[]{}":
                            suffix = char + suffix
                        else:
                            break
                    replacement_parts[-1] = replacement_parts[-1] + suffix
                    
                    result.append(" ".join(replacement_parts))
                    i += dw_len
                    matched = True
                    break
        
        if not matched:
            result.append(words[i])
            i += 1
            
    return " ".join(result)

def merge_geresh(text):
    text = re.sub(r"([א-ת])\s*'\s*([א-ת])", r"\1'\2", text)
    text = re.sub(r'([א-ת])\s*"\s*([א-ת])', r'\1"\2', text)
    return text

def wrap_rtl(text):
    if not text.strip():
        return text
    return "\u202B" + text.strip() + "\u202C"

def generate_emojis(segments):
    emoji_map = {
        "שמח": "😀", "עצוב": "😢", "לב": "❤️", "אש": "🔥",
        "מצחיק": "😂", "כסף": "💰", "רכב": "🚗", "רעיון": "💡"
    }
    
    emoji_items = []
    for seg in segments:
        text = seg.text
        for word, em in emoji_map.items():
            if word in text:
                emoji_items.append({
                    "emoji": em,
                    "start": seg.start,
                    "end": seg.end
                })
                break
    return emoji_items

def main():
    args = parse_args()
    
    print(f"Loading model {args.model}...", flush=True)
    device = args.device
    if device == "auto":
        import ctranslate2
        device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        
    user_dict = []
    if args.dict and os.path.exists(args.dict):
        try:
            with open(args.dict, "r", encoding="utf-8") as f:
                user_dict = json.load(f)
        except Exception:
            pass
            
    initial_prompt = ", ".join(user_dict) if user_dict else None
    hotwords = ",".join([f"{w}:15.0" for w in user_dict]) if user_dict else None

    try:
        model = stable_whisper.load_faster_whisper(
            args.model,
            device=device,
            compute_type="auto"
        )
    except Exception as e:
        print(f"Error loading model: {e}", file=sys.stderr)
        sys.exit(1)

    print("Transcribing...", flush=True)
    result = model.transcribe(
        args.audio,
        language=args.lang if args.lang else None,
        task="translate" if args.translate else "transcribe",
        initial_prompt=initial_prompt,
        hotwords=hotwords,
        word_timestamps=True
    )

    if args.max_words > 0:
        result.split_by_length(max_words=args.max_words)
        
    srt_path = args.audio + ".srt"
    result.to_srt_vtt(srt_path, word_level=False)
    
    # Post-process SRT file to apply geresh merging and RTL
    try:
        with open(srt_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        for i in range(len(lines)):
            line = lines[i].strip()
            # Only process text lines (not empty, not segment numbers, not timestamps)
            if line and not line.isdigit() and '-->' not in line:
                text = line
                text = apply_fuzzy_dictionary(text, user_dict)
                text = merge_geresh(text)
                if args.lang == "he":
                    text = wrap_rtl(text)
                lines[i] = text + '\n'
                
        with open(srt_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)
    except Exception as e:
        print(f"Warning: Failed to post-process SRT: {e}")
        
    print(f"SRT saved to {srt_path}", flush=True)
    
    if args.emoji:
        emoji_items = generate_emojis(result.segments)
        if emoji_items:
            emoji_path = args.audio + ".emoji.json"
            with open(emoji_path, "w", encoding="utf-8") as f:
                json.dump(emoji_items, f, ensure_ascii=False, indent=2)
            print(f"Emojis saved to {emoji_path}", flush=True)

if __name__ == "__main__":
    main()
