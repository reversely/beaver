import assert from "node:assert/strict";
import { test } from "node:test";
import { modelKey } from "../src/models.ts";

test("only the listed Whisper files are served", () => {
  assert.equal(modelKey("/models/onnx-community/whisper-base/config.json"), "onnx-community/whisper-base/config.json");
  assert.equal(modelKey("/models/onnx-community/whisper-base/onnx/decoder_model_merged_quantized.onnx"), "onnx-community/whisper-base/onnx/decoder_model_merged_quantized.onnx");
  assert.equal(modelKey("/models/onnx-community/whisper-base/../../secret"), null);
  assert.equal(modelKey("/models/onnx-community/whisper-base/onnx/encoder_model.onnx"), null);
  assert.equal(modelKey("/models/"), null);
});
