
from pathlib import Path
import secrets
import re
import shutil

root = Path.cwd()
worker_env = root / "ai-worker" / ".env"
model_env = root / "ai-model" / ".env"
server_file = root / "ai-model" / "src" / "server.py"

if not worker_env.is_file():
    raise SystemExit("ERROR: ai-worker/.env not found.")

source = server_file.read_text(encoding="utf-8")

config_anchor = """# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
"""

cpu_line = '    engine = GrainShieldInferenceEngine(model_path=model_path, device="cpu")'

if source.count(config_anchor) != 1:
    raise SystemExit("Unexpected server.py configuration section. No changes made.")

if source.count(cpu_line) != 1:
    raise SystemExit("Expected CPU initialization line not found exactly once. No changes made.")

def set_env_value(content, name, value):
    lines = content.splitlines()
    pattern = re.compile(r"^\s*" + re.escape(name) + r"\s*=")
    matches = [i for i, line in enumerate(lines) if pattern.match(line)]

    if len(matches) > 1:
        raise SystemExit(f"Duplicate {name} entries found. No files written.")

    new_line = f"{name}={value}"

    if matches:
        lines[matches[0]] = new_line
    else:
        lines.append(new_line)

    return "\n".join(lines).rstrip() + "\n"

worker_content = worker_env.read_text(encoding="utf-8")
model_content = model_env.read_text(encoding="utf-8") if model_env.exists() else ""

# Generate one strong, random local API key without displaying it.
api_key = secrets.token_urlsafe(48)

for name, value in [
    ("CV_PROVIDER", "http"),
    ("CV_API_URL", "http://127.0.0.1:8000/verify"),
    ("CV_API_KEY", api_key),
]:
    worker_content = set_env_value(worker_content, name, value)

for name, value in [
    ("CV_API_KEY", api_key),
    ("ENVIRONMENT", "development"),
    ("GRAINSHIELD_DEVICE", "auto"),
]:
    model_content = set_env_value(model_content, name, value)

env_loader = '''# Load the local AI service environment without requiring python-dotenv.
def _load_service_env():
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()

        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\'\\\\"":
            value = value[1:-1]

        if name:
            os.environ.setdefault(name, value)


_load_service_env()

'''

gpu_initialization = '''    requested_device = os.environ.get("GRAINSHIELD_DEVICE", "auto").strip().lower()

    try:
        import torch
        cuda_available = torch.cuda.is_available()
    except Exception:
        cuda_available = False

    if requested_device in {"", "auto"}:
        inference_device = "cuda:0" if cuda_available else "cpu"
    elif requested_device.startswith("cuda") and not cuda_available:
        raise RuntimeError(
            "CUDA was requested but is unavailable. Check the PyTorch CUDA installation."
        )
    else:
        inference_device = requested_device

    print(f"[service] Selected inference device: {inference_device}")
    engine = GrainShieldInferenceEngine(
        model_path=model_path,
        device=inference_device,
    )'''

patched = source.replace(
    config_anchor,
    config_anchor + env_loader,
    1,
).replace(cpu_line, gpu_initialization, 1)

# Keep a backup of server code, but never create a backup containing API secrets.
backup = server_file.with_name("server.py.before_local_auth_gpu.bak")
shutil.copy2(server_file, backup)

worker_env.write_text(worker_content, encoding="utf-8")
model_env.write_text(model_content, encoding="utf-8")
server_file.write_text(patched, encoding="utf-8")

print("SUCCESS: Local CV configuration completed.")
print("Worker provider: HTTP")
print("Python API authentication: configured")
print("Both applications use the same randomly generated key.")
print("Python service now loads ai-model/.env.")
print("Inference device: CUDA when available, otherwise CPU.")
print(f"Server backup: {backup}")
print("Secret values were not displayed.")
