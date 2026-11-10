#!/usr/bin/env python3
"""Publish verified production DMG/CRX assets; never activate an unqualified update."""

from publish_test_update import main


if __name__ == '__main__':
    main(production=True)
