# Model Tool Environments

The backend service can run in the base Python environment, while heavy model
tools may run in their own conda environments. Calls stay the same:

```python
from model_wrappers import remote_models
remote_models.mtp(image="/path/image.png", task="detect")
remote_models.sarmae(image="/path/sar.png", task="detect")
```

`model_wrappers.common.run_in_env()` checks `CONDA_ENV_MAP` and automatically
uses `conda run -n mtp ...` or `conda run -n sarmae ...` when those envs exist.
If an env does not exist, it runs in-process and returns a structured error or
fallback result.

## MTP env

```bash
conda env create -f backend/model_wrappers/envs/mtp.yml
conda activate mtp
pip install -r backend/requirements.txt
pip install openmim
mim install "mmcv==2.0.0"
# Install any extra MTP repo requirements required by /root/autodl-tmp/MTP.
```

Required assets currently found:

```text
/root/autodl-tmp/model_weight/mtp/faster_rcnn_rvsa_b_800_mae_mtp_dior.py
/root/autodl-tmp/model_weight/mtp/dior-rvsa-b-mae-mtp-epoch_12.pth
```

CLI call:

```bash
scripts/model-tools/run-tool.py mtp '{"image":"/tmp/satintel_smoke.png","task":"detect","score_thr":0.3}'
```

## SARMAE real detect env

```bash
conda env create -f backend/model_wrappers/envs/sarmae-detect.yml
conda activate sarmae
pip install -r backend/requirements.txt
pip install openmim
mim install "mmcv==2.0.0"
```

Required env values in `backend/.env`:

```bash
SARMAE_HEADS_DIR=/root/autodl-tmp/model_weight/sarmae_seg_detect_weights
SARMAE_DETECT_REPO=/root/autodl-tmp/model_weight/SARMAE_Fintune/Detection
SARMAE_DETECT_CONFIG=/root/autodl-tmp/model_weight/SARMAE_Fintune/Detection/configs/SARMAE/SSDD/vitb_ssdd.py
```

CLI calls:

```bash
scripts/model-tools/run-tool.py sarmae '{"image":"/tmp/satintel_smoke.png","task":"segment"}'
scripts/model-tools/run-tool.py sarmae '{"image":"/tmp/satintel_smoke.png","task":"detect"}'
```

## Smoke test all tools

```bash
scripts/model-tools/check-model-tools.py /tmp/satintel_smoke.png
```
