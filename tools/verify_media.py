"""Inspect every output frame and compare encodes with the downscaled source."""
import argparse, hashlib, json, re, subprocess, unicodedata
from pathlib import Path
import numpy as np
parser=argparse.ArgumentParser();parser.add_argument('source_directory',type=Path);args=parser.parse_args()
root=Path(__file__).resolve().parents[1]; out=root/'tests/artifacts';out.mkdir(parents=True,exist_ok=True)
sources={unicodedata.normalize('NFC',p.name):p for p in args.source_directory.iterdir()}
records=json.loads((root/'assets/brand/media-manifest.json').read_text());results=[]
for i,record in enumerate(records,1):
 source=sources[f'예지 {i}번.mp4'];target=root/record['file']
 assert hashlib.sha256(source.read_bytes()).hexdigest()==record['source_sha256']
 comparison=subprocess.run(['ffmpeg','-nostdin','-i',str(source),'-i',str(target),'-lavfi','[0:v]scale=1920:1080:flags=lanczos,format=yuv420p[ref];[ref][1:v]ssim','-an','-f','null','-'],capture_output=True,text=True,check=True)
 score=float(re.findall(r'All:([\d.]+)',comparison.stderr)[-1])
 # White background: check the full character silhouette in EVERY frame at 480px width.
 proc=subprocess.Popen(['ffmpeg','-nostdin','-v','error','-i',str(target),'-vf','scale=480:270','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
 count=0; bbox=[480,270,0,0]
 while True:
  data=proc.stdout.read(480*270*3)
  if not data:break
  assert len(data)==480*270*3
  frame=np.frombuffer(data,dtype=np.uint8).reshape(270,480,3)
  y,x=np.where(frame.min(axis=2)<210)
  if x.size:
   bbox=[min(bbox[0],int(x.min())),min(bbox[1],int(y.min())),max(bbox[2],int(x.max())),max(bbox[3],int(y.max()))]
  count+=1
 assert proc.wait()==0 and count==record['frames']
 safe=bbox[0]>105 and bbox[2]<375 and bbox[1]>0 and bbox[3]<269
 assert safe, (i,bbox)
 subprocess.run(['ffmpeg','-nostdin','-y','-v','error','-i',str(target),'-vf','fps=1/5,scale=480:270,tile=3x1','-frames:v','1',str(out/f'clip-{i}-contact.jpg')],check=True)
 result={'clip':i,'frames_checked':count,'ssim_vs_1080p_reference':score,'silhouette_bounds_at_480x270':bbox,'square_crop_safe':safe,'bytes':record['bytes'],'reduction_percent':round(100*(1-record['bytes']/record['source_bytes']),1)}
 results.append(result);print(json.dumps(result),flush=True)
(out/'media-verification.json').write_text(json.dumps(results,indent=2)+'\n')
