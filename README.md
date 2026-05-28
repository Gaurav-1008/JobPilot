# Job Harvester

![Python](https://img.shields.io/badge/python-3.8+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green)

**Job Harvester** is a robust, extensible Python command-line utility for scraping and aggregating job listings from multiple job boards into a unified format (CSV, with extensible support for Google Sheets). 

It intelligently handles deduplication and board-specific nuances (like API filtering and Javascript rendering) to provide a clean dataset of relevant jobs.

## Features

- **Multi-Board Support**: Natively supports `naukri`, `remoteok`, and `wellfound`.
- **Intelligent Deduplication**: Automatically filters out duplicate job postings across different sources.
- **Dynamic Scraping**: Uses `Playwright` for Javascript-heavy sites and `Firecrawl` for robust structured data extraction.
- **Extensible Architecture**: Easily add new job boards by implementing the `BoardAdapter` interface.
- **Virtual Environment Integration**: Automatically detects and executes within its virtual environment to ensure dependency isolation.

## Prerequisites

- Python 3.8 or higher
- Google Chrome (required for Playwright fallback on Naukri)

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/job-harvester.git
   cd job-harvester
   ```

2. **Create and activate a virtual environment**
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows, use `.venv\Scripts\activate`
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Install Playwright browsers**
   ```bash
   playwright install chromium
   ```

## Configuration

Job Harvester requires certain environment variables for specific board adapters and output writers.

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and fill in your credentials:
   - `FIRECRAWL_API_KEY`: Required for scraping Wellfound. Get it from [Firecrawl](https://firecrawl.dev).
   - `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_SHEETS_ID`, `GOOGLE_WORKSHEET_NAME`: (Optional) Required if you plan to implement and use the Google Sheets writer.

## Usage

You can run the script using the `harvester.py` entry point. The script will automatically ensure it runs inside the `.venv` environment.

### Basic Usage

Search for a specific role in a specific location across **all supported boards**:
```bash
python harvester.py --role "Python Developer" --location "Bangalore" --limit 20 --output jobs.csv
```

### Advanced Options

```bash
usage: harvester.py [-h] [--board {naukri,remoteok,wellfound}] --role ROLE
                    [--location LOCATION] [--limit LIMIT] [--output OUTPUT]

options:
  -h, --help            show this help message and exit
  --board {naukri,remoteok,wellfound}
                        Job board to query. Omit to query all supported boards
                        and combine results.
  --role ROLE           Role or title to search for (e.g., "AI ML Engineer").
  --location LOCATION   Location to search in (e.g., "Bangalore").
  --limit LIMIT         Maximum number of results to fetch per board (default: 20).
  --output OUTPUT       Output file path or sheet name (default: jobs.csv).
```

### Examples

**Search a single board:**
```bash
python harvester.py --board remoteok --role "Data Scientist" --limit 50
```

**Search globally (Remote):**
```bash
python harvester.py --role "Frontend Engineer" --location "Remote"
```

## Project Layout

- `harvester.py`: The main CLI entry point that orchestrates fetching and deduplication.
- `boards/`: Contains the base `BoardAdapter` interface and individual board implementations.
  - `base.py`: The abstract base class for all adapters.
  - `naukri.py`: Adapter for Naukri.com using requests and Playwright.
  - `remoteok.py`: Adapter for RemoteOK using its JSON API.
  - `wellfound.py`: Adapter for Wellfound using the Firecrawl SDK.
- `writers.py`: Output helpers for saving aggregated rows to CSV (or Google Sheets).

## Extending

To add a new job board:
1. Create a new file in `boards/` (e.g., `boards/myboard.py`).
2. Create a class that inherits from `BoardAdapter` and implements the `fetch(self, role: str, location: str) -> list[dict]` method.
3. Register your adapter in the `BOARD_ADAPTERS` dictionary in `harvester.py`.

## License

This project is licensed under the MIT License.