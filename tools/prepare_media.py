"""Convert approved originals without modifying them (ffmpeg, ffprobe, Pillow)."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import unicodedata
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('source_directory', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = root / 'assets' / 'brand'
output.mkdir(parents=True, exist_ok=True)
# Fail before doing any work if an output already exists. Replacement is deliberate.
expected = [output / f'ye-g-motion-{n}.mp4' for n in range(1, 5)]
expected += [output / name for name in ('ye-g-poster.png', 'ye-g-poster.webp', 'media-manifest.json')]
if any(path.exists() for path in expected):
    parser.error('Output already exists. Preserve it and use a fresh checkout/output directory.')
sources = {unicodedata.normalize('NFC', p.name): p for p in args.source_directory.iterdir()}

def probe(path):
    return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)]))

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

records = []
for number in range(1, 5):
    source = sources[f'예지 {number}번.mp4']
    target = output / f'ye-g-motion-{number}.mp4'
    before = digest(source)
    original = probe(source)
    subprocess.run(['ffmpeg', '-nostdin', '-n', '-v', 'error', '-i', str(source), '-map', '0:v:0',
                    '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264',
                    '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-level:v', '4.1',
                    '-fps_mode', 'passthrough', '-color_primaries', 'bt709', '-color_trc', 'bt709',
                    '-colorspace', 'bt709', '-color_range', 'tv', '-an', '-sn', '-dn',
                    '-movflags', '+faststart', str(target)], check=True)
    converted = probe(target)
    assert digest(source) == before, 'Original changed'
    src_video = next(s for s in original['streams'] if s['codec_type'] == 'video')
    dst_video = converted['streams'][0]
    assert len(converted['streams']) == 1
    assert (dst_video['width'], dst_video['height'], dst_video['pix_fmt']) == (1920, 1080, 'yuv420p')
    assert src_video['nb_frames'] == dst_video['nb_frames']
    assert src_video['avg_frame_rate'] == dst_video['avg_frame_rate']
    record = {'source': source.name, 'source_sha256': before, 'source_bytes': source.stat().st_size,
              'file': target.relative_to(root).as_posix(), 'sha256': digest(target),
              'bytes': target.stat().st_size, 'width': 1920, 'height': 1080,
              'codec': dst_video['codec_name'], 'pixel_format': dst_video['pix_fmt'],
              'frame_rate': dst_video['avg_frame_rate'], 'frames': int(dst_video['nb_frames']),
              'duration': float(dst_video['duration']), 'audio_tracks': 0, 'color_space': 'bt709'}
    records.append(record)
    print(json.dumps(record, ensure_ascii=False), flush=True)
    if number == 1:
        subprocess.run(['ffmpeg', '-nostdin', '-n', '-v', 'error', '-i', str(source),
                        '-vf', 'scale=1920:1080:flags=lanczos', '-frames:v', '1',
                        str(output / 'ye-g-poster.png')], check=True)
        with Image.open(output / 'ye-g-poster.png') as poster:
            poster.resize((1280, 720), Image.Resampling.LANCZOS).save(
                output / 'ye-g-poster.webp', 'WEBP', lossless=True, method=6)
(output / 'media-manifest.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
