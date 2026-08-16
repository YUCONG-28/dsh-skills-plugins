#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from core.pet_engine import main
if __name__ == "__main__":
    main(pet_dir=os.path.dirname(os.path.abspath(__file__)))
