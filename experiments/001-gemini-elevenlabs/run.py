"""Experiment 001: Gemini and ElevenLabs voice loop on the laptop. See README.md.

uv run --group sandbox python experiments/001-gemini-elevenlabs/run.py <step> [--set section.key=value ...]
"""

import argparse
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

import bilingual
import devices
import gemini
import speech
from record import RunRecord
from settings import HERE, load_config, render_prompt


def speak(config, record, text):
    pcm, rate = speech.synthesize(config, record, text)
    record.save_file("reply.wav", devices.pcm_to_wav(pcm, rate))
    devices.play_pcm(config, record, pcm, rate)


def answer_aloud(config, record, prompt_role, media, extra_vars=None):
    system = render_prompt(config, "system")
    reply = gemini.ask(
        config, record, system, render_prompt(config, prompt_role, extra_vars), media
    )
    print(f"\n----- reply -----\n{reply}")
    speak(config, record, reply)
    return reply


def recorded_question(config, record):
    wav, seconds = devices.record_wav(config, record)
    path = record.save_file("question.wav", wav)
    return [(wav, "audio/wav", f"{path.name}: {seconds:.1f} s of microphone audio")]


def step_text(config, record, args):
    question = " ".join(args.words) or config["prompt_vars"]["question"]
    system = render_prompt(config, "system")
    reply = gemini.ask(
        config, record, system, render_prompt(config, "text", {"question": question})
    )
    print(f"\n----- reply -----\n{reply}")
    return reply


def step_speak(config, record, args):
    text = (
        " ".join(args.words)
        or "Bonjour, and welcome. I am your guide to Canadian culture."
    )
    speak(config, record, text)
    return text


def step_voice(config, record, args):
    return answer_aloud(config, record, "voice", recorded_question(config, record))


def step_camera(config, record, args):
    extra = {"camera_question": " ".join(args.words)} if args.words else None
    jpeg = devices.capture_jpeg(config, record)
    path = record.save_file("frame.jpg", jpeg)
    media = [(jpeg, "image/jpeg", f"{path.name}: {len(jpeg) // 1024} KB camera frame")]
    return answer_aloud(config, record, "camera", media, extra)


def step_translate(config, record, args):
    return answer_aloud(config, record, "translate", recorded_question(config, record))


def image_attachment(config, record, image_file):
    """A saved image when `image_file` is set, else a fresh camera frame."""
    if image_file:
        jpeg = (HERE / image_file).read_bytes()
        source = image_file
    else:
        jpeg = devices.capture_jpeg(config, record)
        source = "camera frame"
    path = record.save_file("frame.jpg", jpeg)
    return (jpeg, "image/jpeg", f"{path.name}: {len(jpeg) // 1024} KB {source}")


def step_look(config, record, args):
    """Typed words replace the microphone, so the step can run without speaking."""
    if args.words:
        question = [
            render_prompt(config, "typed_question", {"question": " ".join(args.words)})
        ]
    else:
        question = recorded_question(config, record)
    image = (
        [image_attachment(config, record, config["look"]["image_file"])]
        if config["look"]["include_image"]
        else []
    )
    return answer_aloud(config, record, "look", image + question)


def step_imagetest(config, record, args):
    """Every question with every image variant, typed and unspoken; writes report.md."""
    settings = config["imagetest"]
    image = image_attachment(config, record, settings["image_file"])
    system = render_prompt(config, "system")
    instruction = render_prompt(config, "look")
    print(
        f"----- system prompt -----\n{system}\n\n----- instruction -----\n{instruction}"
    )
    record.show_prompts = False
    # Rows live in the record, so a run stopped by a quota error still saves its replies.
    rows = record.data.setdefault("imagetest", [])
    for question in settings["questions"]:
        typed = render_prompt(config, "typed_question", {"question": question["text"]})
        for variant in settings["variants"]:
            config["gemini"]["media_resolution"] = (
                "" if variant in ("none", "default") else variant
            )
            attachments = [typed] if variant == "none" else [image, typed]
            time.sleep(settings["pause_seconds"] if rows else 0)
            reply = gemini.ask(config, record, system, instruction, attachments)
            tokens = record.data["gemini_tokens"]
            rows.append(
                {
                    **question,
                    "variant": variant,
                    "text_tokens": tokens["prompt_by_type"].get("text", 0),
                    "image_tokens": tokens["prompt_by_type"].get("image", 0),
                    "prompt_tokens": tokens["prompt"],
                    "reply_tokens": tokens["reply"],
                    "thinking_tokens": tokens["thinking"],
                    "gemini_ms": record.data["timings_ms"]["gemini"],
                    "reply": reply,
                }
            )
            print(
                f"{question['kind']:>9}  {variant:>7}  {tokens['prompt']:>5} prompt tokens  "
                f"{record.data['timings_ms']['gemini']:>6} ms  {question['text']}"
            )
    report = imagetest_report(config, rows)
    record.save_file("report.md", report.encode())
    print(f"\n{report}")
    return f"{len(rows)} requests; see report.md"


def imagetest_report(config, rows):
    lines = [
        f"# Image test, {config['gemini']['model']}",
        "",
        (
            "| Kind | Question | Image | Text tokens | Image tokens | Prompt tokens "
            "| Reply tokens | Thinking tokens | Gemini ms |"
        ),
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r['kind']} | {r['text']} | {r['variant']} | {r['text_tokens']} "
            f"| {r['image_tokens']} | {r['prompt_tokens']} | {r['reply_tokens']} "
            f"| {r['thinking_tokens']} | {r['gemini_ms']} |"
        )
    lines.append("")
    for question in config["imagetest"]["questions"]:
        lines += ["", f"## {question['kind']}: {question['text']}"]
        for r in rows:
            if r["text"] == question["text"]:
                lines += ["", f"**Image {r['variant']}:** {r['reply']}"]
    return "\n".join(lines) + "\n"


def step_usage(config, args):
    from datetime import UTC, datetime

    from elevenlabs import ElevenLabs

    plan = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"]).user.subscription.get()
    remaining = plan.character_limit - plan.character_count
    resets = datetime.fromtimestamp(
        plan.next_character_count_reset_unix, tz=UTC
    ).astimezone()
    print(f"ElevenLabs plan: {plan.tier}")
    print(f"Characters used: {plan.character_count:,} of {plan.character_limit:,}")
    print(f"Remaining:       {remaining:,}")
    print(f"Resets:          {resets:%Y-%m-%d %H:%M}")


def step_list(config, args):
    from elevenlabs import ElevenLabs
    from google import genai

    # Hold the client in a variable: the pager outlives the call, and a collected client closes.
    gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    print("Gemini models that generate content:")
    for model in gemini_client.models.list():
        if "generateContent" in (model.supported_actions or []):
            print(f"  {model.name.removeprefix('models/')}")
    client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
    print("\nElevenLabs models:")
    for model in client.models.list():
        languages = ", ".join(lang.name for lang in (model.languages or [])[:6])
        print(
            f"  {model.model_id}  ({languages}{', ...' if len(model.languages or []) > 6 else ''})"
        )
    print("\nElevenLabs voices:")
    for voice in client.voices.search(page_size=100).voices:
        print(f"  {voice.voice_id}  {voice.name}")


def bilingual_turn(config, record, question, image_file):
    """Answer, translate, and speak sentence by sentence; record per-sentence timings."""
    image = [image_attachment(config, record, image_file)] if image_file else []
    start = time.perf_counter()
    result = bilingual.answer(config, record, question, image)
    record.mark("text_ready", start)
    print(
        f"\n----- {result['visitor']['name']} speaker, languages {result['codes']} -----"
    )
    sentences = []
    for piece in bilingual.synthesize_in_order(config, result["groups"]):
        if not sentences:
            record.mark("first_audio_ready", start)
        name = f"g{piece['group'] + 1}-{piece['code']}.wav"
        record.save_file(name, devices.pcm_to_wav(piece["pcm"], piece["rate"]))
        print(f"  [{piece['code']}] {piece['text']}")
        sentences.append({k: v for k, v in piece.items() if k not in ("pcm", "rate")})
        devices.play_pcm(config, record, piece["pcm"], piece["rate"])
    record.mark("all_spoken", start)
    record.data["timings_ms"].pop("playback", None)
    record.data["sentences"] = sentences
    record.data["elevenlabs_characters"] = sum(len(s["text"]) for s in sentences)
    # waited_ms after the first sentence is silence between sentences while synthesis catches up.
    record.data["gap_ms_total"] = sum(s["waited_ms"] for s in sentences[1:])
    record.data["question_text"] = result["question"]
    return result


def step_bilingual(config, record, args):
    """7. Typed words, or the microphone when none are given."""
    if args.words:
        question = [
            render_prompt(config, "typed_question", {"question": " ".join(args.words)})
        ]
    else:
        question = recorded_question(config, record)
    result = bilingual_turn(config, record, question, config["bilingual"]["image_file"])
    return " / ".join(text for group in result["groups"] for _, text in group)


def step_bilingualtest(config, record, args):
    """Run each concept-sheet case as its own run folder; print a summary table."""
    settings = config["bilingualtest"]
    rows = []
    for i, case in enumerate(settings["cases"]):
        if i:
            time.sleep(settings["pause_seconds"])
        print(f"\n===== {case['name']}: {case['question']}")
        case_record = RunRecord(config, f"bilingual-{case['name']}")
        question = [
            render_prompt(config, "typed_question", {"question": case["question"]})
        ]
        try:
            bilingual_turn(config, case_record, question, case["image_file"])
            case_record.finish(reply="see sentences")
        except SystemExit as error:
            case_record.finish(error=str(error))
            raise
        data, t = case_record.data, case_record.data["timings_ms"]
        rows.append(
            {
                "case": case["name"],
                "mode": config["answer"]["mode"],
                "answer_ms": t.get("gemini_answer"),
                "translate_ms": t.get("gemini_translate", 0),
                "first_audio_ms": t["first_audio_ready"],
                "all_spoken_ms": t["all_spoken"],
                "gap_ms": data["gap_ms_total"],
                "sentences": len(data["sentences"]),
                "characters": data["elevenlabs_characters"],
                "tokens": sum(
                    v["prompt"] + v["reply"] + v["thinking"]
                    for k, v in data.items()
                    if k.endswith("_tokens")
                ),
            }
        )
    header = list(rows[0])
    table = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    table += ["| " + " | ".join(str(r[h]) for h in header) + " |" for r in rows]
    report = "\n".join(table) + "\n"
    record.save_file("report.md", report.encode())
    print(f"\n{report}")
    return report


STEPS = {
    "text": (step_text, "1. Typed question to Gemini, text reply"),
    "speak": (step_speak, "2. Text to ElevenLabs speech, played aloud"),
    "voice": (step_voice, "3. Microphone to Gemini to ElevenLabs"),
    "camera": (step_camera, "4. Camera frame to Gemini to ElevenLabs"),
    "translate": (step_translate, "5. French/English voice loop"),
    "look": (step_look, "6. Question plus camera image to Gemini to ElevenLabs"),
    "imagetest": (step_imagetest, "Questions with and without the image, compared"),
    "bilingual": (step_bilingual, "7. Sentence-by-sentence reply in each language"),
    "bilingualtest": (step_bilingualtest, "The concept-sheet cases through step 7"),
}
# Account queries that make no run folder.
QUERIES = {"list": step_list, "usage": step_usage}


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "step",
        choices=[*STEPS, *QUERIES],
        help="; ".join(desc for _, desc in STEPS.values()),
    )
    parser.add_argument(
        "words",
        nargs="*",
        help="question or text for the text, speak, camera, and look steps",
    )
    parser.add_argument("--config", type=Path, default=HERE / "config.toml")
    parser.add_argument(
        "--set", action="append", default=[], metavar="SECTION.KEY=VALUE"
    )
    args = parser.parse_args()

    load_dotenv(HERE.parents[1] / ".env")
    missing = [
        key
        for key in ("GEMINI_API_KEY", "ELEVENLABS_API_KEY")
        if not os.environ.get(key)
    ]
    if missing:
        sys.exit(f"Missing from .env: {', '.join(missing)}")
    config = load_config(args.config, args.set)

    if args.step in QUERIES:
        QUERIES[args.step](config, args)
        return
    record = RunRecord(config, args.step)
    step, _ = STEPS[args.step]
    try:
        reply = step(config, record, args)
    except (SystemExit, Exception) as error:
        record.finish(error=f"{type(error).__name__}: {error}")
        raise
    record.finish(reply=reply)


if __name__ == "__main__":
    main()
