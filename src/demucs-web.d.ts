declare module 'demucs-web' {
  export type Stereo = { left: Float32Array; right: Float32Array };
  export type SeparationResult = Record<'drums' | 'bass' | 'other' | 'vocals', Stereo>;
  export const CONSTANTS: { DEFAULT_MODEL_URL: string; TRAINING_SAMPLES: number; SEGMENT_OVERLAP: number };
  export class DemucsProcessor {
    session: import('onnxruntime-web').InferenceSession | null;
    constructor(options: {
      ort: typeof import('onnxruntime-web');
      sessionOptions?: import('onnxruntime-web').InferenceSession.SessionOptions;
      onProgress?: (info: { progress: number; currentSegment: number; totalSegments: number }) => void;
      onLog?: (phase: string, message: string) => void;
    });
    loadModel(buffer: ArrayBuffer): Promise<void>;
    separate(left: Float32Array, right: Float32Array): Promise<SeparationResult>;
  }
}
