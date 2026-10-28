#!/usr/bin/env python3
"""Deterministically port existing dsh-pet video pixels into a Codex v1 atlas.

Requires Python 3 with Pillow, and FFmpeg with the libvpx-vp9 decoder.
No AI generation or API access is used. See ATTRIBUTION.md for artwork terms.
"""
import argparse
import glob
import hashlib
import io
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

UPSTREAM_COMMIT = '2b72c1bd246e851c5e1b4890db834aba3452af43'
UPSTREAM = 'https://github.com/PC2005-cloud/dsh-pet'
CELL = (192, 208)
# Source timestamps are quarter-second frame indices, sampled at 4 fps.
# Keep one shared transform across all states: do not recrop each frame.
ROWS = [
    ('idle', '待机呼吸休闲', [0, 4, 6, 8, 10, 12], [280,110,110,140,140,320]),
    ('running-right', '原地左转奔跑', [9,10,11,12,13,14,15,16], [120]*7+[220]),
    ('running-left', '原地左转奔跑', [9,10,11,12,13,14,15,16], [120]*7+[220]),
    ('waving', '点击回应-元气挥手', [7,11,14,23], [140,140,140,280]),
    ('jumping', '点击回应-开心跃动', [12,14,17,24,26], [140]*4+[280]),
    ('failed', '工作状态-垂头叹气冒汗', [6,8,9,10,12,14,17,19], [140]*7+[240]),
    ('waiting', '工作状态-原地踱步张望', [18,20,22,24,26,28], [150]*5+[260]),
    ('running', '工作状态-忙碌点按', [7,8,9,10,11,8], [120]*5+[220]),
    ('review', '工作状态-清点归档', [10,11,12,13,16,18], [150]*5+[280]),
]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def decode(ffmpeg, path, indices):
    result = subprocess.run([ffmpeg, '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(path),
        '-vf', 'fps=4', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'],
        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    frame_bytes = 640 * 360 * 4
    if len(result.stdout) % frame_bytes:
        raise ValueError(f'Unexpected decoded video dimensions: {path}')
    count = len(result.stdout) // frame_bytes
    if max(indices) >= count:
        raise ValueError(f'Missing requested frame in {path}: {count} decoded frames')
    frames = [Image.frombytes('RGBA', (640,360), result.stdout[i*frame_bytes:(i+1)*frame_bytes])
        for i in indices]
    if any(frame.getchannel('A').getextrema() != (0,255) for frame in frames):
        raise ValueError(f'Expected transparent VP9 frames with opaque body pixels: {path}')
    return frames

def transform(frame, scale, mirror):
    # VP9 alpha decoding leaves black canvas pixels at alpha=1 (1/255).
    # Drop only this imperceptible matte and resampling residue, before/after fit.
    frame.putalpha(frame.getchannel('A').point(lambda v: 0 if v <= 2 else v))
    if mirror:
        frame = ImageOps.mirror(frame)
    # A fixed source origin (320,331) is shared by every frame and animation.
    size = (round(640*scale), round(360*scale))
    frame = frame.resize(size, Image.Resampling.LANCZOS)
    cell = Image.new('RGBA', CELL)
    cell.alpha_composite(frame, (round(96-320*scale), round(196-331*scale)))
    cell.putalpha(cell.getchannel('A').point(lambda v: 0 if v <= 2 else v))
    # Normalize hidden RGB after cleaning the near-zero-alpha canvas.
    zero = Image.new('RGBA', CELL)
    zero.paste(cell, (0,0), cell.getchannel('A').point(lambda v: 255 if v else 0))
    return zero

def font(size):
    candidates = ['/System/Library/Fonts/PingFang.ttc'] + glob.glob(
        '/System/Library/AssetsV2/com_apple_MobileAsset_Font*/**/PingFang.ttc', recursive=True)
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc', size)

def on_background(frame, color='#e9eef6'):
    background = Image.new('RGBA', CELL, color)
    background.alpha_composite(frame)
    return background.convert('RGB')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-repo', required=True, type=Path)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    source = args.source_repo.resolve()
    actual_commit = subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'], text=True).strip()
    if actual_commit != UPSTREAM_COMMIT:
        raise SystemExit(f'Expected upstream commit {UPSTREAM_COMMIT}; got {actual_commit}')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    qa = output / 'verification'
    qa.mkdir(exist_ok=True)
    all_frames = []
    provenance = []
    # Preserve one common scale and baseline, including jump height.
    scale = 0.58
    for state, name, indices, durations in ROWS:
        path = source / 'dsh-pet/assets/webm' / (name+'.webm')
        original = decode(args.ffmpeg, path, indices)
        frames = [transform(frame, scale, state=='running-right') for frame in original]
        all_frames.append(frames)
        provenance.append({'state':state, 'source':f'dsh-pet/assets/webm/{name}.webm',
            'source_sha256':digest(path), 'sample_times_seconds':[i/4 for i in indices],
            'mirror_horizontal':state=='running-right', 'durations_ms':durations})
        animated = [on_background(frame) for frame in frames]
        animated[0].save(qa/f'{state}.gif', save_all=True, append_images=animated[1:],
            duration=durations, loop=0, disposal=2)

    atlas = Image.new('RGBA', (1536,1872))
    for row, frames in enumerate(all_frames):
        for column, frame in enumerate(frames):
            atlas.paste(frame, (column*192,row*208))
    atlas.save(output/'spritesheet.webp', 'WEBP', lossless=True, exact=True, method=6)
    # Inspect the exact encoded bytes, not the in-memory image.
    with Image.open(output/'spritesheet.webp') as encoded:
        encoded = encoded.convert('RGBA')
        if encoded.tobytes() != atlas.tobytes():
            raise ValueError('Lossless atlas roundtrip mismatch')
    manifest = {'id':'dsh-whale-maid', 'displayName':'DSH 鲸鱼娘',
        'description':'来自 dsh-pet 的 DeepSeek 社区鲸鱼娘，九种 Codex 原生工作状态。',
        'spriteVersionNumber':1, 'spritesheetPath':'spritesheet.webp'}
    (output/'pet.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    provenance_record = {'upstream':UPSTREAM, 'upstream_commit':actual_commit,
        'spriteVersionNumber':1, 'atlas_size':[1536,1872], 'cell_size':list(CELL),
        'scale':scale, 'source_origin':[320,331], 'destination_origin':[96,196],
        'alpha_cleanup':'Set alpha <= 2/255 to zero before and after resize; clear hidden RGB',
        'ffmpeg_decoder':'libvpx-vp9', 'rows':provenance,
        'spritesheet_sha256':digest(output/'spritesheet.webp'),
        'limitations':['9 native animations; original DSH menus and services are not ported',
            'No 16-direction gaze: original source does not contain authored gaze cells']}
    (output/'provenance.json').write_text(json.dumps(provenance_record,ensure_ascii=False,indent=2)+'\n')
    # Contact sheet shows the exact native geometry and frame order.
    contact = Image.new('RGB', (8*192+130,9*232+20), '#f5f7fb')
    draw = ImageDraw.Draw(contact)
    for row, (spec,frames) in enumerate(zip(ROWS,all_frames)):
        draw.text((8,row*232+95), spec[0], fill='#24314c', font=font(16))
        for column,frame in enumerate(frames):
            contact.paste(on_background(frame), (130+column*192,row*232+24))
            draw.text((140+column*192,row*232+5),str(column+1),fill='#52627b',font=font(13))
    contact.save(qa/'contact-sheet.png')
    labels = ['待机','向右移动','向左移动','挥手','跳跃','出错','等待输入','工作中','检查结果']
    preview = []
    for time_ms in range(0,6000,100):
        board = Image.new('RGB',(3*208,3*246),'#f5f7fb')
        draw = ImageDraw.Draw(board)
        for i,(frames,spec) in enumerate(zip(all_frames,ROWS)):
            durations = spec[3]
            phase = time_ms % sum(durations)
            frame_index = 0
            while frame_index < len(durations)-1 and phase >= durations[frame_index]:
                phase -= durations[frame_index]
                frame_index += 1
            x,y = (i%3)*208,(i//3)*246
            draw.text((x+14,y+10),labels[i],fill='#24314c',font=font(17))
            board.paste(on_background(frames[frame_index]), (x+8,y+34))
        preview.append(board)
    preview[0].save(output/'preview.gif',save_all=True,append_images=preview[1:],
        duration=100,loop=0,disposal=2,optimize=False)
    preview[0].save(output/'preview.png')
    print(json.dumps({'output':str(output), 'sha256':digest(output/'spritesheet.webp'),
        'size_bytes':(output/'spritesheet.webp').stat().st_size,'frames':sum(map(len,all_frames))}))

if __name__=='__main__':
    main()
