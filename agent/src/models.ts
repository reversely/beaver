// The Whisper base files the page's in-browser transcription needs (#64), stored in the R2 bucket
// under the same paths transformers.js asks for. Only these names are served.

export const MODEL = "onnx-community/whisper-base";

export const MODEL_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];

const ALLOWED = new Set(MODEL_FILES.map((f) => `${MODEL}/${f}`));

/** The R2 key for a /models/ path, or null for anything outside the list. */
export function modelKey(pathname: string): string | null {
  const key = pathname.replace(/^\/models\//, "");
  return ALLOWED.has(key) ? key : null;
}
