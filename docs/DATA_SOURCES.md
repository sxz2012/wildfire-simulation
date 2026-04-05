# Data Sources

This document describes all external data sources used in the Wildfire Spread Visualization project.

---

## 1. Fire Hotspot Detections — NASA FIRMS

- **Provider:** NASA Fire Information for Resource Management System (FIRMS)
- **URL:** https://firms.modaps.eosdis.nasa.gov/
- **API Endpoint:** `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{BBOX}/{DAYS}/{DATE}`
- **Sensors:** VIIRS instrument on Suomi-NPP and NOAA-20 satellites (375m spatial resolution)
- **Data Fields:** Latitude, longitude, acquisition date/time, Fire Radiative Power (MW), brightness temperature (K), confidence level, day/night flag
- **Coverage:** Global, updated every ~12 hours per satellite pass
- **Cost:** Free (requires MAP_KEY obtained via email registration)
- **Usage in Project:**
  - 30 historical fire event replays
  - ML training dataset: 880,397 individual hotspot detections
  - Environmental impact estimation (area burned, emissions)

---

## 2. Historical Weather — Open-Meteo Archive API

- **Provider:** Open-Meteo
- **URL:** https://open-meteo.com/
- **API Endpoint:** `https://archive-api.open-meteo.com/v1/archive?latitude=X&longitude=Y&start_date=X&end_date=Y&daily=...`
- **Data Fields:** Daily mean/max temperature (°C), relative humidity (%), max wind speed (km/h), dominant wind direction (°), precipitation sum (mm)
- **Coverage:** Global, historical data back to 1940+
- **Cost:** Free, no API key required
- **Usage in Project:** Weather features for ML model training (correlated with each fire event's daily progression)

---

## 3. Live Weather Forecast — Open-Meteo Forecast API

- **Provider:** Open-Meteo
- **API Endpoint:** `https://api.open-meteo.com/v1/forecast?latitude=X&longitude=Y&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m`
- **Data Fields:** Current temperature, humidity, wind speed, wind direction
- **Coverage:** Global, real-time
- **Cost:** Free, no API key required
- **Usage in Project:** Fetches real-time weather conditions when user clicks on the globe in simulation mode

---

## 4. Land Cover Classification — OpenLandMap (Copernicus CGLS)

- **Provider:** OpenLandMap / Copernicus Global Land Service
- **URL:** https://geoserver.openlandmap.org/
- **API Endpoint:** WMS GetFeatureInfo query against `olm:land_cover_copernicus` layer
- **Resolution:** 100 meters
- **Classification:** 22 classes including closed/open forest (by leaf type), shrubland, grassland, cropland, urban, water, wetland, bare ground
- **Coverage:** Global
- **Cost:** Free, no API key required
- **Usage in Project:** Fuel type classification for ML training features and satellite-based vegetation assignment in simulation mode

---

## 5. 3D Globe & Satellite Imagery — Google Photorealistic 3D Tiles

- **Provider:** Google Maps Platform via CesiumJS
- **Access Method:** `createGooglePhotorealistic3DTileset()` in Cesium API
- **Data:** Photorealistic 3D terrain with high-resolution satellite imagery, 3D buildings, and terrain mesh
- **Coverage:** Global (varying resolution by area)
- **Cost:** Google Maps Platform API key required; $200/month free credit (sufficient for development)
- **Usage in Project:** Main 3D globe visualization — the base layer on which all fire data is rendered

---

## 6. Terrain Elevation — Cesium World Terrain & Open-Meteo

- **Providers:**
  - Cesium World Terrain (via Cesium Ion) — used for 3D terrain rendering
  - Open-Meteo Elevation API — used for point elevation queries
- **API Endpoint:** `https://api.open-meteo.com/v1/elevation?latitude=X&longitude=Y`
- **Resolution:** ~90 meters (SRTM-based)
- **Cost:** Free (Cesium Ion requires access token; Open-Meteo is free with no key)
- **Usage in Project:** Terrain rendering in the 3D viewer; elevation data for ML training features

---

## 7. ML Fire Spread Model — Trained Locally

- **Type:** XGBoost gradient-boosted decision tree classifier
- **Configuration:** 300 trees, max depth 8, learning rate 0.1
- **Training Data:** 251,429 balanced samples from 30 historical fires across 13 countries
- **Features Used:** 18 input features (weather, location, fire detection properties, neighbor density, fuel type)
- **Performance:**
  - Accuracy: 88.2%
  - AUC-ROC: 0.948
  - Precision (fire persists): 89%
  - Recall (fire persists): 94%
- **Top Predictive Features:**
  1. Precipitation (17.1%)
  2. Cumulative precipitation (14.3%)
  3. Daytime vs nighttime (8.0%)
  4. Maximum temperature (6.5%)
  5. Humidity (6.0%)
  6. Wind speed (5.8%)
- **File:** `src/data/xgboost_model.json` (2.2 MB, 300 serialized decision trees)
- **Inference:** Runs in browser via Web Worker using a custom TypeScript tree evaluator

---

## Summary Table

| Data Source | Provider | Resolution | Cost | API Key Required |
|---|---|---|---|---|
| Fire Hotspots | NASA FIRMS | 375m | Free | Yes (email signup) |
| Historical Weather | Open-Meteo | ~11km | Free | No |
| Live Weather | Open-Meteo | ~11km | Free | No |
| Land Cover | OpenLandMap/Copernicus | 100m | Free | No |
| 3D Globe | Google Maps / CesiumJS | Varies | Free tier | Yes |
| Elevation | Open-Meteo / Cesium | ~90m | Free | Cesium Ion token |
| ML Model | Local (XGBoost) | N/A | N/A | N/A |

---

## Data Volume

| Dataset | Records | Size |
|---|---|---|
| Raw FIRMS hotspot detections | 880,397 | 101 MB |
| Balanced ML training set | 251,429 | 29 MB |
| Historical weather (30 fires) | ~530 daily records | ~150 KB |
| XGBoost model (exported) | 300 trees | 2.2 MB |
| Historical fire JSON files (30) | ~483,000 hotspots | 22 MB |
