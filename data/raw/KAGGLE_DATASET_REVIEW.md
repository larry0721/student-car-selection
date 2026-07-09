# Kaggle Dataset Review

Date: 2026-07-08

## Downloaded Datasets

| Folder | Kaggle ref | Rows inspected | Best fields | Main gaps |
| --- | --- | ---: | --- | --- |
| `craigslist-carstrucks-data` | `austinreese/craigslist-carstrucks-data` | 432,199 | US used price, year, manufacturer, model, odometer, condition, fuel, transmission, drive, body type, state, image URL, listing URL | No MPG, MSRP, safety, reliability; some missing condition/drive/body type |
| `car-features-msrp` | `CooperUnion/cardataset` | 11,914 | Make, model, year, fuel type, horsepower, cylinders, transmission, driven wheels, size/style, city/highway MPG, MSRP | Not used prices; older static catalog; no odometer, safety, reliability |
| `uk-used-car-100k` | `adityadesai13/used-car-dataset-ford-and-mercedes` | 118,150 | Clean used price, year, mileage, transmission, fuel type, MPG, engine size across several brands | UK market, prices in GBP, no make column inside each brand file unless inferred from filename, limited brands |
| `used-cars-price-prediction` | `avikasliwal/used-cars-price-prediction` | 7,253 | Name, location, year, kilometers driven, fuel, transmission, owner, mileage, engine, power, seats, new price, used price | India market, smaller, price units need conversion/context |
| `vehicle-dataset-cardekho` | `nehalbirla/vehicle-dataset-from-cardekho` | 14,828 | Multiple Cardekho files; best file has make, model, price, year, kilometers, fuel, transmission, owner, engine, drivetrain, dimensions, seating capacity | India market, multiple overlapping schemas, no US pricing, no safety/reliability |

## Recommendation

Use `austinreese/craigslist-carstrucks-data` as the primary raw market dataset for this project because the app targets first-time used-car buyers and needs real used-car prices, mileage, listing URLs, location, transmission, drivetrain, fuel, condition, and body type. It is also US-market data, which fits the current app better than the UK and India datasets.

Use `CooperUnion/cardataset` as the primary enrichment dataset for specs such as MPG, MSRP, horsepower, driven wheels, and vehicle style.

Keep `uk-used-car-100k`, `used-cars-price-prediction`, and `vehicle-dataset-cardekho` as secondary comparison/training datasets, but do not make them the production source for US recommendations without currency/market normalization.

## Added Coverage Pass

Additional Kaggle datasets were added to reduce strict-filter `No match` cases:

- `lepchenkov/usedcarscatalog`: adds compact used-market rows with transmission, drivetrain, body type, odometer, year, and USD price. This improves manual, AWD/4WD, wagon, minivan, and broader body-style coverage.
- `peshimaammuzammil/2023-car-model-dataset-all-data-you-need`: adds current-model specs for newer-year searches where used listings are sparse.
- `urvishahir/electric-vehicle-specifications-dataset-2025`: adds EV specs such as drivetrain, seats, range, body type, efficiency, and cargo volume.
- `upcoderr/car-specifications-dataset`: inspected as a compact spec/price source, but it lacks model names, so it is kept as a secondary reference rather than a primary catalog input.

The processed catalog is now selected with body-style and capability quotas so default economy cars do not crowd out trucks, coupes, convertibles, wagons, minivans, manuals, AWD/4WD vehicles, EVs, and newer models.

## Important Gap

None of the top Kaggle datasets inspected provide trustworthy safety or reliability scores. Keep safety/reliability as separate overlays from NHTSA/IIHS-style data, repair-cost datasets, insurance datasets, or user-uploaded CSVs.
