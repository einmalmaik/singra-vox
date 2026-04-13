#!/usr/bin/env python3

# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
import base64
import importlib.util
import sys

if importlib.util.find_spec("pywebpush") is None:
    print("Error: pywebpush not installed. Run 'pip install pywebpush' first.")
    sys.exit(1)

def generate_vapid_keys():
    # pywebpush provides a way to generate keys if needed, 
    # but we can also use the standard way it expects.
    # Actually, the simplest is to use the underlying cryptography if available.
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization

    private_key = ec.generate_private_key(ec.SECP256R1())
    private_bytes = private_key.private_numbers().private_value.to_bytes(32, byteorder='big')
    
    public_key = private_key.public_key()
    public_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint
    )
    
    # Base64URL encoding as required by VAPID
    def b64url(data):
        return base64.urlsafe_b64encode(data).decode('utf-8').rstrip('=')

    return b64url(private_bytes), b64url(public_bytes)

if __name__ == "__main__":
    priv, pub = generate_vapid_keys()
    print(f"VAPID_PRIVATE_KEY={priv}")
    print(f"VAPID_PUBLIC_KEY={pub}")
