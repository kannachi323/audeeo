#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
public_dir="$(cd -- "${script_dir}/../../public" && pwd)"
output_dir="${public_dir}/demos"
artwork="${script_dir}/three-pigs-panorama.png"
audio="${script_dir}/three-pigs-narration.wav"
overlays="${script_dir}/work/overlays"
mp4="${output_dir}/three-little-pigs-live.mp4"
webm="${output_dir}/three-little-pigs-live.webm"
poster="${output_dir}/three-little-pigs-poster.jpg"

mkdir -p "${output_dir}"

python_bin="${AUDEEO_VIDEO_PYTHON:-python3}"
"${python_bin}" "${script_dir}/generate-overlays.py"
"${python_bin}" "${script_dir}/render-caption-track.py"

ffmpeg -y -hide_banner -loglevel warning \
  -loop 1 -framerate 30 -i "${artwork}" \
  -i "${audio}" \
  -loop 1 -framerate 30 -i "${overlays}/base.png" \
  -i "${script_dir}/work/caption-track.mov" \
  -filter_complex \
  "[1:a]asplit=2[aout][waveaudio];
   [waveaudio]showwaves=s=1840x54:mode=line:colors=0x78d7a4@0.9:scale=sqrt:r=30,format=rgba[wave];
   [0:v]scale=2200:-1,zoompan=z='1.035+0.018*sin(on/155)':x='iw/2-(iw/zoom/2)+55*sin(on/210)':y='ih/2-(ih/zoom/2)+12*cos(on/170)':d=1:s=1920x1080:fps=30,eq=saturation=0.9:contrast=1.03[scene];
   [scene]drawbox=x=0:y=0:w=iw:h=82:color=0x11110f@0.88:t=fill,
          drawbox=x=0:y=720:w=iw:h=360:color=0x11110f@0.88:t=fill[frame];
   [frame][wave]overlay=40:744:shortest=1[withwave];
   [withwave][2:v]overlay=0:0:shortest=1[base];
   [base][3:v]overlay=0:720:shortest=1,
              drawbox=x=0:y=1072:w=iw:h=8:color=0x3b3a36:t=fill,
              drawbox=x=0:y=1072:w='iw*min(t/30.304,1)':h=8:color=0x78d7a4:t=fill[vout]" \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -movflags +faststart -shortest "${mp4}"

ffmpeg -y -hide_banner -loglevel warning -i "${mp4}" \
  -c:v libvpx-vp9 -crf 31 -b:v 0 -row-mt 1 \
  -c:a libopus -b:a 128k "${webm}"

ffmpeg -y -hide_banner -loglevel warning -ss 17.8 -i "${mp4}" \
  -frames:v 1 -update 1 -q:v 2 "${poster}"

printf '%s\n%s\n%s\n' "${mp4}" "${webm}" "${poster}"
