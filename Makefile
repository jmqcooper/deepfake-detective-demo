# Shortcuts for the tested local setup. See README.md.
.PHONY: install samples dev test check check-runtime check-scripts release-check docker docker-check

SAMPLES := web/public/samples/manifest.json
PYTHON ?= python3.12
VENV_PYTHON := .venv/bin/python
VENV_DEPS := .venv/.deps
# A stamp inside the gitignored samples dir tracks the *generated dev fixture*.
# Editing the fixture generator, the pack builder, or the pinned deps invalidates
# it, so make regenerates the fixture; an untouched tree stays fast.
STAMP := web/public/samples/.dev-fixture
SAMPLE_SOURCES := tools/make_synthetic_dutch_fixture.py tools/prepare_samples.py
PYTHON_SOURCES := $(shell git ls-files ':(glob)tools/**/*.py')
SHELL_SOURCES := $(shell git ls-files ':(glob)tools/**/*.sh' ':(glob)ops/**/*.sh')
NODE_SOURCES := $(shell git ls-files ':(glob)tools/**/*.mjs' ':(glob)ops/**/*.mjs')

install: web/node_modules $(VENV_DEPS)

web/node_modules:
	cd web && npm ci

$(VENV_PYTHON):
	$(PYTHON) -m venv .venv

$(VENV_DEPS): tools/requirements.in tools/requirements.txt | $(VENV_PYTHON)
	$(VENV_PYTHON) -m pip install --require-hashes -r tools/requirements.txt
	touch $(VENV_DEPS)

# Ensure a sample pack exists, without ever clobbering a real one: if a manifest
# is present and it is not the synthetic fixture, it is a production pack a
# contributor built — leave it untouched. Otherwise (re)build the dev fixture.
samples:
	@if [ -f "$(SAMPLES)" ] && ! grep -q '"source":[[:space:]]*"Synthetic Dutch integrity fixture' "$(SAMPLES)"; then \
		echo "Keeping existing production sample pack (web/public/samples/); not regenerating the dev fixture."; \
	else \
		$(MAKE) $(STAMP); \
	fi

# Build the local development fixture (tones + silence, not exhibit-quality).
$(STAMP): $(SAMPLE_SOURCES) $(VENV_DEPS)
	$(VENV_PYTHON) tools/make_synthetic_dutch_fixture.py --out tools/.cache/fixture
	$(VENV_PYTHON) tools/prepare_samples.py --cache tools/.cache/fixture --out web/public/samples
	$(VENV_PYTHON) tools/prepare_samples.py --out web/public/samples --verify-only
	touch $(STAMP)

dev: web/node_modules samples
	cd web && npm run dev

check-runtime: web/node_modules
	node tools/check_runtime.mjs

check-scripts: $(VENV_PYTHON)
	PYTHONPYCACHEPREFIX=tools/.cache/pycache $(VENV_PYTHON) -m py_compile $(PYTHON_SOURCES)
	@for script in $(SHELL_SOURCES); do bash -n "$$script"; done
	@for script in $(NODE_SOURCES); do node --check "$$script"; done

test: web/node_modules $(VENV_DEPS)
	$(VENV_PYTHON) -m unittest discover -s tools/tests -v
	cd web && npm test

release-check: $(VENV_DEPS) samples
	$(VENV_PYTHON) tools/prepare_samples.py --out web/public/samples --verify-only

check: install samples check-runtime check-scripts
	$(VENV_PYTHON) -m unittest discover -s tools/tests -v
	cd web && npm run check
	$(VENV_PYTHON) tools/prepare_samples.py --out web/public/samples --verify-only
	tools/run_e2e.sh

docker:
	docker compose up -d --build

docker-check:
	tools/test_docker.sh
