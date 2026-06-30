// Pure PCM 16-bit WAV encoder. Converts an AudioBuffer to a downloadable Blob
// using a standard RIFF/WAVE header. No external dependencies.

/**
 * Encode an AudioBuffer as a 16-bit PCM WAV file Blob.
 *
 * Interleaves all channels in the AudioBuffer (mono or stereo). Output sample
 * rate matches the input buffer's rate.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const numFrames = buffer.length;
  const dataBytes = numFrames * blockAlign;

  // Total file size: 44-byte header + PCM data
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataBytes);
  const view = new DataView(arrayBuffer);

  // --- RIFF header ---
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true); // file size - 8
  writeString(view, 8, 'WAVE');

  // --- fmt sub-chunk ---
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // sub-chunk size (PCM = 16)
  view.setUint16(20, 1, true); // audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // --- data sub-chunk ---
  writeString(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  // Interleave channel data and convert float [-1, 1] to int16.
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = headerSize;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/** Trigger a browser download of a WAV blob. */
export function downloadWav(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.wav') ? filename : `${filename}.wav`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
