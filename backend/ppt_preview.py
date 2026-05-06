import subprocess
import os
import uuid
import glob
from pdf2image import convert_from_path


def pptx_to_images(pptx_path: str, output_dir: str = "/tmp/slideai_previews") -> list[str]:
    """
    Convert a .pptx file to a list of PNG image paths (one per slide).
    Uses LibreOffice headless to convert to PDF, then pdf2image to render pages.

    Returns list of absolute image paths in slide order.
    """
    os.makedirs(output_dir, exist_ok=True)

    # Unique subfolder per conversion to avoid collisions
    job_id  = uuid.uuid4().hex[:8]
    job_dir = os.path.join(output_dir, job_id)
    os.makedirs(job_dir, exist_ok=True)

    # Step 1: PPTX → PDF via LibreOffice headless
    result = subprocess.run(
        [
            "libreoffice", "--headless", "--convert-to", "pdf",
            "--outdir", job_dir, pptx_path
        ],
        capture_output=True, text=True, timeout=60
    )

    if result.returncode != 0:
        raise RuntimeError(f"LibreOffice conversion failed: {result.stderr}")

    # Find the generated PDF
    pdf_files = glob.glob(os.path.join(job_dir, "*.pdf"))
    if not pdf_files:
        raise RuntimeError("LibreOffice did not produce a PDF file")

    pdf_path = pdf_files[0]

    # Step 2: PDF → PNG images (one per page/slide)
    images = convert_from_path(pdf_path, dpi=150, fmt="png")

    image_paths = []
    for i, img in enumerate(images):
        img_path = os.path.join(job_dir, f"slide_{i + 1}.png")
        img.save(img_path, "PNG")
        image_paths.append(img_path)

    return image_paths
