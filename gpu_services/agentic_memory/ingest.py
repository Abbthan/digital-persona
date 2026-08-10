import io
import os
import tempfile
from dataclasses import dataclass

import pytesseract
from PIL import Image

CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
MIN_NATIVE_TEXT_LEN = 20


@dataclass
class ExtractedDoc:
    text_chunks: list[str]
    image_ocr_chunks: list[str]


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    paragraphs = [paragraph.strip() for paragraph in text.split("\n") if paragraph.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        candidate = f"{current}\n{paragraph}" if current else paragraph
        if len(candidate) <= chunk_size:
            current = candidate
            continue
        if current:
            chunks.append(current)
        if len(paragraph) <= chunk_size:
            current = paragraph
            continue
        start = 0
        while start < len(paragraph):
            end = start + chunk_size
            chunks.append(paragraph[start:end])
            start = end - overlap
        current = ""
    if current:
        chunks.append(current)
    return chunks


def _ocr_image_bytes(image_bytes: bytes) -> str:
    try:
        image = Image.open(io.BytesIO(image_bytes))
        return pytesseract.image_to_string(image, lang="chi_sim+eng").strip()
    except Exception:
        return ""


def extract_pdf(path: str) -> ExtractedDoc:
    import fitz

    text_parts: list[str] = []
    ocr_parts: list[str] = []
    document = fitz.open(path)
    try:
        for page in document:
            page_text = page.get_text().strip()
            if page_text:
                text_parts.append(page_text)
            if len(page_text) < MIN_NATIVE_TEXT_LEN:
                text = _ocr_image_bytes(page.get_pixmap(dpi=200).tobytes("png"))
                if text:
                    ocr_parts.append(text)
                continue
            for image_info in page.get_images(full=True):
                try:
                    image_bytes = document.extract_image(image_info[0])["image"]
                except Exception:
                    continue
                text = _ocr_image_bytes(image_bytes)
                if text:
                    ocr_parts.append(text)
    finally:
        document.close()
    return ExtractedDoc(chunk_text("\n\n".join(text_parts)), chunk_text("\n\n".join(ocr_parts)))


def extract_docx(path: str) -> ExtractedDoc:
    import docx

    document = docx.Document(path)
    text = "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text.strip())
    ocr_parts: list[str] = []
    for relationship in document.part.rels.values():
        if "image" not in relationship.reltype:
            continue
        try:
            image_bytes = relationship.target_part.blob
        except Exception:
            continue
        extracted = _ocr_image_bytes(image_bytes)
        if extracted:
            ocr_parts.append(extracted)
    return ExtractedDoc(chunk_text(text), chunk_text("\n\n".join(ocr_parts)))


def extract_document(filename: str, raw_bytes: bytes) -> ExtractedDoc:
    extension = os.path.splitext(filename)[1].lower()
    if extension == ".txt":
        return ExtractedDoc(chunk_text(raw_bytes.decode("utf-8", errors="replace")), [])
    if extension in {".jpg", ".jpeg", ".png"}:
        # Standalone photo uploads can contain handwriting, captions,
        # screenshots or signs that reveal both facts and the owner's actual
        # wording. Keep OCR in document_images so retrieval can distinguish
        # visual text from native document text while treating both as
        # owner-authorized persona evidence.
        extracted = _ocr_image_bytes(raw_bytes)
        return ExtractedDoc([], chunk_text(extracted))
    if extension not in {".pdf", ".docx"}:
        raise ValueError(f"Unsupported document type: {extension}")
    with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as temporary:
        temporary.write(raw_bytes)
        path = temporary.name
    try:
        return extract_pdf(path) if extension == ".pdf" else extract_docx(path)
    finally:
        os.unlink(path)
