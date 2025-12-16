from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained("Helsinki-NLP/opus-mt-zh-en")
tokenizer.save_pretrained("../models/opus_mt_zh_en_tokenizer")