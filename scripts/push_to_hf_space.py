"""Publish the built site (dist/) to a Hugging Face static Space.

Usage: HF_TOKEN=... HF_SPACE=user/rag-ai-studio python scripts/push_to_hf_space.py dist
"""
import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

SPACE_README = """---
title: RAG AI Studio
emoji: 📚
colorFrom: green
colorTo: blue
sdk: static
app_file: index.html
pinned: false
license: mit
short_description: Chat with any document - cited, evaluated RAG
---

RAG AI Studio: upload documents (PDF, DOCX, HTML, Markdown, text) and chat with
them. Answers cite document pages, and every answer shows per-step timing,
groundedness, relevance and confidence. Everything runs in your browser; files
never leave it.

Source: https://github.com/{github_repo}
"""


def main() -> None:
    dist = Path(sys.argv[1] if len(sys.argv) > 1 else "dist")
    space = os.environ["HF_SPACE"]
    token = os.environ["HF_TOKEN"]
    (dist / "README.md").write_text(
        SPACE_README.format(github_repo=os.environ.get("GITHUB_REPOSITORY", "")), encoding="utf-8"
    )
    api = HfApi(token=token)
    api.create_repo(space, repo_type="space", space_sdk="static", exist_ok=True)
    api.upload_folder(
        folder_path=str(dist),
        repo_id=space,
        repo_type="space",
        commit_message=f"Deploy {os.environ.get('GITHUB_SHA', 'local build')[:7]}",
        delete_patterns=["assets/*"],
    )
    print(f"Deployed to https://huggingface.co/spaces/{space}")


if __name__ == "__main__":
    main()
