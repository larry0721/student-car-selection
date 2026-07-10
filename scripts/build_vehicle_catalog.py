import csv
import json
import re
import statistics
from collections import defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed" / "vehicleCatalog.json"
REPORT = ROOT / "data" / "processed" / "vehicleCatalog.metadata.json"

TARGET_MAKES = {
    "toyota",
    "honda",
    "mazda",
    "subaru",
    "hyundai",
    "kia",
    "ford",
    "chevrolet",
    "nissan",
    "volkswagen",
    "gmc",
    "ram",
    "dodge",
    "jeep",
    "chrysler",
    "mitsubishi",
}

MODEL_ALIASES = {
    "rav": "rav4",
    "rav4": "rav4",
    "cr": "cr-v",
    "crv": "cr-v",
    "hr": "hr-v",
    "hrv": "hr-v",
    "cx": "cx-5",
    "mazda3": "3",
    "mazda6": "6",
    "corolla": "corolla",
    "camry": "camry",
    "civic": "civic",
    "accord": "accord",
    "fit": "fit",
    "prius": "prius",
    "impreza": "impreza",
    "crosstrek": "crosstrek",
    "forester": "forester",
    "outback": "outback",
    "elantra": "elantra",
    "sonata": "sonata",
    "kona": "kona",
    "soul": "soul",
    "sportage": "sportage",
    "optima": "optima",
    "focus": "focus",
    "fusion": "fusion",
    "c": "c-max",
    "cmax": "c-max",
    "escape": "escape",
    "cruze": "cruze",
    "malibu": "malibu",
    "equinox": "equinox",
    "sentra": "sentra",
    "altima": "altima",
    "rogue": "rogue",
    "versa": "versa",
    "golf": "golf",
    "jetta": "jetta",
    "passat": "passat",
    "tacoma": "tacoma",
    "tundra": "tundra",
    "ridgeline": "ridgeline",
    "frontier": "frontier",
    "ranger": "ranger",
    "maverick": "maverick",
    "f": "f-150",
    "f150": "f-150",
    "f250": "f-250",
    "f350": "f-350",
    "silverado": "silverado",
    "colorado": "colorado",
    "sierra": "sierra",
    "ram": "1500",
    "1500": "1500",
    "gladiator": "gladiator",
    "patriot": "patriot",
    "4runner": "4runner",
    "mustang": "mustang",
    "camaro": "camaro",
    "challenger": "challenger",
    "miata": "miata",
    "mx": "miata",
    "brz": "brz",
    "fr": "fr-s",
    "wrx": "wrx",
    "sienna": "sienna",
    "odyssey": "odyssey",
    "pacifica": "pacifica",
    "caravan": "caravan",
    "sedona": "sedona",
    "rio": "rio",
    "accent": "accent",
    "spark": "spark",
    "bolt": "bolt",
    "leaf": "leaf",
    "id": "id.4",
    "ioniq": "ioniq",
    "niro": "niro",
}

BODY_BY_MODEL = {
    "rav4": "suv",
    "cr-v": "suv",
    "hr-v": "suv",
    "cx-5": "suv",
    "forester": "suv",
    "outback": "suv",
    "crosstrek": "suv",
    "kona": "suv",
    "sportage": "suv",
    "escape": "suv",
    "equinox": "suv",
    "rogue": "suv",
    "prius": "hatchback",
    "fit": "hatchback",
    "impreza": "hatchback",
    "soul": "hatchback",
    "golf": "hatchback",
    "focus": "hatchback",
    "c-max": "hatchback",
    "tacoma": "truck",
    "tundra": "truck",
    "ridgeline": "truck",
    "frontier": "truck",
    "ranger": "truck",
    "maverick": "truck",
    "f-150": "truck",
    "f-250": "truck",
    "f-350": "truck",
    "silverado": "truck",
    "colorado": "truck",
    "sierra": "truck",
    "1500": "truck",
    "gladiator": "truck",
    "patriot": "suv",
    "4runner": "suv",
    "sienna": "minivan",
    "odyssey": "minivan",
    "pacifica": "minivan",
    "caravan": "minivan",
    "sedona": "minivan",
    "mustang": "coupe",
    "camaro": "coupe",
    "challenger": "coupe",
    "miata": "convertible",
    "brz": "coupe",
    "fr-s": "coupe",
    "outback": "wagon",
}

BLOCKED_MODEL_PATTERNS = (
    "vt1300",
    "cbr",
    "crf",
    "goldwing",
    "gold wing",
    "shadow",
    "rebel",
    "rancher",
    "foreman",
    "trx",
)

RELIABILITY_BY_MAKE = {
    "Toyota": 91,
    "Honda": 88,
    "Mazda": 84,
    "Subaru": 80,
    "Hyundai": 80,
    "Kia": 78,
    "Ford": 76,
    "Chevrolet": 75,
    "Nissan": 74,
    "Volkswagen": 72,
    "Gmc": 72,
    "Ram": 70,
    "Dodge": 69,
    "Jeep": 70,
    "Chrysler": 68,
    "Mitsubishi": 72,
}

RESALE_BY_MAKE = {
    "Toyota": 88,
    "Honda": 85,
    "Subaru": 82,
    "Mazda": 79,
    "Hyundai": 72,
    "Kia": 70,
    "Ford": 69,
    "Chevrolet": 68,
    "Nissan": 67,
    "Volkswagen": 66,
    "Gmc": 67,
    "Ram": 66,
    "Dodge": 64,
    "Jeep": 72,
    "Chrysler": 62,
    "Mitsubishi": 62,
}


def norm(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def model_family(value):
    text = norm(value)
    if not text:
        return ""
    joined = text.replace(" ", "")
    if joined.startswith("f150"):
        return "f-150"
    if joined.startswith("f250"):
        return "f-250"
    if joined.startswith("f350"):
        return "f-350"
    if joined.startswith("silverado"):
        return "silverado"
    if joined.startswith("mx5") or joined.startswith("miata"):
        return "miata"
    if joined.startswith("id4"):
        return "id.4"
    if joined.startswith("crv"):
        return "cr-v"
    if joined.startswith("hrv"):
        return "hr-v"
    if joined.startswith("cx5"):
        return "cx-5"
    first = text.split()[0]
    return MODEL_ALIASES.get(first, first)


def title_case_make(value):
    special = {"volkswagen": "Volkswagen"}
    text = norm(value)
    return special.get(text, text.title())


def parse_int(value):
    try:
        number = float(str(value or "").replace(",", "").replace("$", "").strip())
        return int(number)
    except ValueError:
        match = re.search(r"\d+(?:,\d{3})*(?:\.\d+)?", str(value or ""))
        if not match:
            return None
        return int(float(match.group(0).replace(",", "")))


def parse_mpg(value):
    numbers = [parse_int(match) for match in re.findall(r"\d+", str(value or ""))]
    clean = [number for number in numbers if number]
    return int(statistics.mean(clean)) if clean else None


def parse_float(value):
    try:
        return float(str(value or "").replace(",", "").replace("$", "").strip())
    except ValueError:
        return None


def median(values):
    clean = [value for value in values if value is not None]
    return int(statistics.median(clean)) if clean else None


def read_specs():
    specs = {}
    path = RAW / "car-features-msrp" / "data.csv"
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            make = title_case_make(row.get("Make"))
            family = model_family(row.get("Model"))
            year = parse_int(row.get("Year"))
            if not make or not family or not year:
                continue
            key = (make, family, year)
            specs.setdefault(key, []).append(row)

    collapsed = {}
    for key, rows in specs.items():
        mpg_values = [parse_int(row.get("city mpg")) for row in rows] + [parse_int(row.get("highway MPG")) for row in rows]
        hp_values = [parse_int(row.get("Engine HP")) for row in rows]
        msrp_values = [parse_int(row.get("MSRP")) for row in rows]
        sample = rows[0]
        collapsed[key] = {
            "mpg": median(mpg_values),
            "horsepower": median(hp_values),
            "msrp": median(msrp_values),
            "drivetrain": normalize_drive(sample.get("Driven_Wheels")),
            "transmission": normalize_transmission(sample.get("Transmission Type")),
            "bodyType": normalize_body(sample.get("Vehicle Style"), family),
            "fuelType": normalize_fuel(sample.get("Engine Fuel Type")),
        }

    read_2023_specs(collapsed)
    read_ev_specs(collapsed)
    return collapsed


def read_2023_specs(collapsed):
    path = RAW / "2023-car-model-dataset" / "Car_Models.csv"
    if not path.exists():
        return
    with path.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        for row in csv.DictReader(handle):
            make = title_case_make(row.get("Company"))
            family = model_family(row.get("Model"))
            if not make or not family:
                continue
            collapsed[(make, family, 2023)] = {
                "mpg": parse_mpg(row.get("Fuel Economy")),
                "horsepower": parse_int(row.get("Horsepower")),
                "msrp": parse_int(row.get("Price")),
                "drivetrain": normalize_drive(row.get("Drivetrain")),
                "transmission": normalize_transmission(row.get("Transmission Type")),
                "bodyType": normalize_body(row.get("Body Type"), family),
                "fuelType": normalize_fuel(row.get("Engine Type")),
            }


def read_ev_specs(collapsed):
    path = RAW / "electric-vehicle-specs-2025" / "electric_vehicles_spec_2025.csv.csv"
    if not path.exists():
        return
    with path.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        for row in csv.DictReader(handle):
            make = title_case_make(row.get("brand"))
            family = model_family(row.get("model"))
            if not make or not family:
                continue
            efficiency = parse_float(row.get("efficiency_wh_per_km"))
            mpg_equivalent = int(21000 / efficiency) if efficiency else None
            collapsed[(make, family, 2025)] = {
                "mpg": mpg_equivalent,
                "horsepower": None,
                "msrp": None,
                "drivetrain": normalize_drive(row.get("drivetrain")),
                "transmission": "automatic",
                "bodyType": normalize_body(row.get("car_body_type") or row.get("segment"), family),
                "fuelType": "electric",
                "seats": parse_int(row.get("seats")),
                "cargo": parse_int(row.get("cargo_volume_l")),
            }


def empty_group(source):
    return {
        "prices": [],
        "miles": [],
        "conditions": [],
        "fuel": [],
        "transmission": [],
        "drive": [],
        "body": [],
        "image": "",
        "url": "",
        "source": source,
    }


def read_craigslist(specs):
    groups = defaultdict(lambda: empty_group("craigslist-carstrucks-data"))
    path = RAW / "craigslist-carstrucks-data" / "vehicles.csv"
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            make_raw = norm(row.get("manufacturer"))
            if make_raw not in TARGET_MAKES:
                continue
            make = title_case_make(make_raw)
            family = model_family(row.get("model"))
            year = parse_int(row.get("year"))
            price = parse_int(row.get("price"))
            miles = parse_int(row.get("odometer"))
            listing_text = " ".join([str(row.get("model") or ""), str(row.get("description") or ""), str(row.get("url") or "")])
            if not family or is_blocked_model(row.get("model")) or not year or not price or not miles:
                continue
            if is_low_quality_listing(listing_text):
                continue
            if year < 2014 or year > 2022 or price < 3500 or price > 26000 or miles < 1000 or miles > 150000:
                continue

            body_guess = normalize_body(row.get("type"), family)
            transmission_guess = normalize_transmission(row.get("transmission")) or "automatic"
            drive_guess = normalize_drive(row.get("drive")) or ""
            key = (make, family, year, transmission_guess, drive_guess, body_guess)
            group = groups[key]
            group["prices"].append(price)
            group["miles"].append(miles)
            group["conditions"].append(row.get("condition") or "")
            group["fuel"].append(row.get("fuel") or "")
            group["transmission"].append(row.get("transmission") or "")
            group["drive"].append(row.get("drive") or "")
            group["body"].append(row.get("type") or "")
            if not group["image"] and row.get("image_url"):
                group["image"] = row["image_url"]
            if not group["url"] and row.get("url"):
                group["url"] = row["url"]

    vehicles = []
    for (make, family, year, *_), group in groups.items():
        if len(group["prices"]) < minimum_group_size(group):
            continue
        spec = specs.get((make, family, year)) or nearest_spec(specs, make, family, year)
        price = median(group["prices"])
        mileage = median(group["miles"])
        if not price or not mileage:
            continue
        vehicles.append(build_vehicle(make, family, year, price, mileage, group, spec))

    return sorted(
        vehicles,
        key=lambda vehicle: (
            -portfolio_score(vehicle),
            vehicle["price"],
            vehicle["make"],
            vehicle["model"],
            -vehicle["year"],
        ),
    )


def read_usedcarscatalog(specs):
    groups = defaultdict(lambda: empty_group("usedcarscatalog"))
    path = RAW / "usedcarscatalog" / "cars.csv"
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        for row in csv.DictReader(handle):
            make_raw = norm(row.get("manufacturer_name"))
            if make_raw not in TARGET_MAKES:
                continue
            make = title_case_make(make_raw)
            family = model_family(row.get("model_name"))
            year = parse_int(row.get("year_produced"))
            price = parse_int(row.get("price_usd"))
            km = parse_int(row.get("odometer_value"))
            miles = int(km * 0.621371) if km else None
            if not family or is_blocked_model(row.get("model_name")) or not year or not price or not miles:
                continue
            if year < 2014 or year > 2024 or price < 3500 or price > 30000 or miles < 1000 or miles > 150000:
                continue

            body_guess = normalize_body(row.get("body_type"), family)
            transmission_guess = normalize_transmission(row.get("transmission")) or "automatic"
            drive_guess = normalize_drive(row.get("drivetrain")) or ""
            key = (make, family, year, transmission_guess, drive_guess, body_guess)
            group = groups[key]
            group["prices"].append(price)
            group["miles"].append(miles)
            group["conditions"].append(row.get("state") or "")
            group["fuel"].append(row.get("engine_fuel") or row.get("engine_type") or "")
            group["transmission"].append(row.get("transmission") or "")
            group["drive"].append(row.get("drivetrain") or "")
            group["body"].append(row.get("body_type") or "")

    vehicles = []
    for (make, family, year, *_), group in groups.items():
        if len(group["prices"]) < minimum_group_size(group):
            continue
        spec = specs.get((make, family, year)) or nearest_spec(specs, make, family, year)
        price = median(group["prices"])
        mileage = median(group["miles"])
        if not price or not mileage:
            continue
        vehicles.append(build_vehicle(make, family, year, price, mileage, group, spec))
    return vehicles


def read_2023_model_vehicles(specs):
    path = RAW / "2023-car-model-dataset" / "Car_Models.csv"
    if not path.exists():
        return []
    vehicles = []
    with path.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        for row in csv.DictReader(handle):
            make_raw = norm(row.get("Company"))
            if make_raw not in TARGET_MAKES:
                continue
            make = title_case_make(make_raw)
            family = model_family(row.get("Model"))
            price = parse_int(row.get("Price"))
            if not family or not price or price < 18000 or price > 42000:
                continue
            group = empty_group("2023-car-model-dataset")
            group["prices"].append(price)
            group["miles"].append(500)
            group["conditions"].append("new")
            group["fuel"].append(row.get("Engine Type") or "")
            group["transmission"].append(row.get("Transmission Type") or "")
            group["drive"].append(row.get("Drivetrain") or "")
            group["body"].append(row.get("Body Type") or "")
            spec = specs.get((make, family, 2023)) or {}
            vehicles.append(build_vehicle(make, family, 2023, price, 500, group, spec))
    return vehicles


def read_ev_model_vehicles(specs):
    path = RAW / "electric-vehicle-specs-2025" / "electric_vehicles_spec_2025.csv.csv"
    if not path.exists():
        return []
    vehicles = []
    with path.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        for row in csv.DictReader(handle):
            make_raw = norm(row.get("brand"))
            if make_raw not in TARGET_MAKES:
                continue
            make = title_case_make(make_raw)
            family = model_family(row.get("model"))
            if not family:
                continue
            body = normalize_body(row.get("car_body_type") or row.get("segment"), family)
            price = estimate_ev_price(make, body, row)
            if price > 48000:
                continue
            group = empty_group("electric-vehicle-specs-2025")
            group["prices"].append(price)
            group["miles"].append(500)
            group["conditions"].append("new")
            group["fuel"].append("electric")
            group["transmission"].append("automatic")
            group["drive"].append(row.get("drivetrain") or "")
            group["body"].append(row.get("car_body_type") or row.get("segment") or "")
            spec = specs.get((make, family, 2025)) or {}
            vehicles.append(build_vehicle(make, family, 2025, price, 500, group, spec))
    return vehicles


def nearest_spec(specs, make, family, year):
    candidates = [
        (abs(spec_year - year), value)
        for (spec_make, spec_family, spec_year), value in specs.items()
        if spec_make == make and spec_family == family
    ]
    return min(candidates, default=(999, {}), key=lambda item: item[0])[1]


def build_vehicle(make, family, year, price, mileage, group, spec):
    body = spec.get("bodyType") or normalize_body(most_common(group["body"]), family)
    drivetrain = normalize_drive(most_common(group["drive"])) or spec.get("drivetrain") or "FWD"
    transmission = normalize_transmission(most_common(group["transmission"])) or spec.get("transmission") or "automatic"
    fuel = normalize_fuel(most_common(group["fuel"])) or spec.get("fuelType") or "gas"
    mpg = spec.get("mpg") or estimate_mpg(body, fuel, year)
    mpg = cap_mpg(mpg, fuel, body)
    hp = spec.get("horsepower") or estimate_hp(body)
    reliability = reliability_score(make, family, mileage)
    safety = safety_score(body, drivetrain, year)
    cargo = cargo_score(body, family)
    resale = resale_score(make, family)
    feature = feature_score(year, body)
    performance = performance_score(hp, body)

    model = display_model(family)
    source_slug = norm(group.get("source") or "kaggle").replace(" ", "-")
    return {
        "id": f"{make}-{family}-{year}-{source_slug}".lower().replace(" ", "-"),
        "make": make,
        "model": model,
        "year": year,
        "bodyType": body,
        "fuelType": fuel,
        "drivetrain": drivetrain,
        "transmission": transmission,
        "mileage": mileage,
        "price": price,
        "condition": condition_score(most_common(group["conditions"]), mileage),
        "mpg": mpg,
        "insurance": insurance_estimate(make, body, price, performance),
        "maintenanceEstimate": maintenance_estimate(make, body, mileage, year),
        "depreciationEstimate": depreciation_estimate(price, resale, year),
        "reliabilityScore": reliability,
        "safetyScore": safety,
        "performanceScore": performance,
        "cargoScore": cargo,
        "resaleScore": resale,
        "featureScore": feature,
        "seats": spec.get("seats") or seats_for_body(body, family),
        "pros": pros(make, family, body, mpg, drivetrain, reliability, safety),
        "watchouts": watchouts(make, family, body, transmission, mileage, price),
        "commonIssues": common_issues(make, family, body, transmission),
        "imageUrl": group["image"] or None,
        "imageSource": "craigslist-kaggle-archived" if group["image"] else None,
        "imageVerified": False,
        "listingUrl": group["url"] or None,
    }


def normalize_drive(value):
    text = norm(value)
    if "4wd" in text or "four" in text:
        return "4WD"
    if "awd" in text or "all wheel" in text:
        return "AWD"
    if "rear" in text or text == "rwd":
        return "RWD"
    if "front" in text or text == "fwd":
        return "FWD"
    return ""


def normalize_transmission(value):
    text = norm(value)
    if "manual" in text:
        return "manual"
    if "cvt" in text or "variable" in text:
        return "CVT"
    if text:
        return "automatic"
    return ""


def normalize_fuel(value):
    text = norm(value)
    if "electric" in text:
        return "electric"
    if "hybrid" in text:
        return "hybrid"
    if "diesel" in text:
        return "diesel"
    return "gas" if text else ""


def normalize_body(value, family):
    text = norm(value)
    if family in BODY_BY_MODEL:
        return BODY_BY_MODEL[family]
    if "convertible" in text or "cabriolet" in text:
        return "convertible"
    if "coupe" in text or "2dr" in text or "2 door" in text:
        return "coupe"
    if "mini van" in text or "minivan" in text or "van" in text:
        return "minivan"
    if "wagon" in text or "universal" in text or "estate" in text:
        return "wagon"
    if "pickup" in text or "truck" in text:
        return "truck"
    if "suv" in text or "crossover" in text:
        return "suv"
    if "hatch" in text:
        return "hatchback"
    return "sedan"


def most_common(values):
    counts = defaultdict(int)
    for value in values:
        text = str(value or "").strip()
        if text:
            counts[text] += 1
    return max(counts.items(), key=lambda item: item[1])[0] if counts else ""


def is_low_quality_listing(text):
    lowered = norm(text)
    blocked = [
        "cash for junk",
        "junk cars",
        "we buy",
        "wanted",
        "parts only",
        "mechanic special",
        "salvage",
        "not running",
        "engine blown",
        "transmission blown",
        "no title",
    ]
    return any(term in lowered for term in blocked)


def is_blocked_model(value):
    text = norm(value)
    return any(pattern in text for pattern in BLOCKED_MODEL_PATTERNS)


def minimum_group_size(group):
    body = normalize_body(most_common(group["body"]), "")
    transmission = normalize_transmission(most_common(group["transmission"]))
    drivetrain = normalize_drive(most_common(group["drive"]))
    source = group.get("source")
    if source in {"2023-car-model-dataset", "electric-vehicle-specs-2025"}:
        return 1
    if transmission == "manual" or drivetrain in {"AWD", "4WD"}:
        return 1
    if body in {"truck", "coupe", "convertible", "wagon", "minivan"}:
        return 1
    return 3


def clamp(value, low=0, high=100):
    return max(low, min(high, int(round(value))))


def display_model(family):
    names = {
        "cr-v": "CR-V",
        "hr-v": "HR-V",
        "cx-5": "CX-5",
        "rav4": "RAV4",
        "f-150": "F-150",
        "fr-s": "FR-S",
        "id.4": "ID.4",
        "3": "3",
        "6": "6",
    }
    return names.get(family, family.title())


def reliability_score(make, family, mileage):
    score = RELIABILITY_BY_MAKE.get(make, 74)
    if family in {"prius", "corolla", "camry", "fit", "civic", "rav4"}:
        score += 3
    if mileage > 115000:
        score -= 5
    elif mileage < 60000:
        score += 2
    return clamp(score)


def safety_score(body, drivetrain, year):
    score = 80 + min(10, max(0, year - 2014) * 1.1)
    if body in {"suv", "minivan", "wagon"}:
        score += 2
    if drivetrain in {"AWD", "4WD"}:
        score += 2
    return clamp(score)


def cargo_score(body, family):
    if body == "truck":
        return 92
    if body == "minivan":
        return 94
    if body == "wagon":
        return 84
    if body == "suv":
        return 82
    if body == "hatchback":
        return 72
    if family in {"fit", "prius", "soul"}:
        return 76
    return 50


def resale_score(make, family):
    score = RESALE_BY_MAKE.get(make, 66)
    if family in {"tacoma", "rav4", "cr-v", "civic", "corolla", "prius", "crosstrek"}:
        score += 4
    return clamp(score)


def feature_score(year, body):
    return clamp(52 + (year - 2014) * 4 + (4 if body in {"suv", "minivan", "wagon"} else 0))


def performance_score(hp, body):
    baseline = 115 if body in {"sedan", "hatchback", "wagon"} else 145
    return clamp(48 + (hp - baseline) * 0.18)


def estimate_mpg(body, fuel, year):
    base = 30 if body in {"sedan", "hatchback", "coupe", "wagon"} else 25
    if fuel == "hybrid":
        base += 14
    if fuel == "diesel":
        base += 5
    return clamp(base + max(0, year - 2014) * 0.3, 15, 55)


def cap_mpg(mpg, fuel, body):
    if fuel == "electric":
        return clamp(mpg, 75, 140)
    if fuel == "hybrid":
        return clamp(mpg, 20, 60)
    if fuel == "diesel":
        return clamp(mpg, 18, 48)
    if body in {"suv", "minivan", "wagon"}:
        return clamp(mpg, 17, 38)
    if body == "truck":
        return clamp(mpg, 14, 30)
    return clamp(mpg, 18, 45)


def estimate_hp(body):
    return {
        "sedan": 155,
        "hatchback": 140,
        "suv": 175,
        "truck": 220,
        "coupe": 220,
        "convertible": 210,
        "wagon": 170,
        "minivan": 245,
    }.get(body, 155)


def insurance_estimate(make, body, price, performance):
    base = 112 + price / 900
    if body == "truck":
        base += 14
    if body in {"coupe", "convertible"}:
        base += 22
    if performance > 70:
        base += 12
    if make in {"Honda", "Hyundai", "Kia"}:
        base += 8
    if make in {"Toyota", "Subaru"}:
        base -= 4
    return int(round(base))


def maintenance_estimate(make, body, mileage, year):
    age = 2026 - year
    base = 65 + age * 4 + max(0, mileage - 60000) / 1600
    if body in {"suv", "truck", "minivan"}:
        base += 18
    if make in {"Toyota", "Honda"}:
        base -= 12
    return int(round(max(75, base)))


def depreciation_estimate(price, resale, year):
    age = max(1, 2026 - year)
    rate = 0.055 if age >= 7 else 0.08
    rate += (100 - resale) / 1300
    return int(round(price * rate))


def condition_score(condition, mileage):
    text = norm(condition)
    if "new" in text or "like" in text:
        return 5
    if "excellent" in text:
        return 4
    if "good" in text:
        return 3
    if mileage < 50000:
        return 4
    if mileage > 120000:
        return 2
    return 3


def seats_for_body(body, family):
    if body == "truck":
        return 5
    if body == "minivan":
        return 7
    if body in {"coupe", "convertible"}:
        return 4
    return 5


def pros(make, family, body, mpg, drivetrain, reliability, safety):
    items = []
    if reliability >= 86:
        items.append("Strong reliability profile")
    if mpg >= 32:
        items.append("Efficient fuel economy")
    if drivetrain in {"AWD", "4WD"}:
        items.append("Bad-weather traction")
    if body in {"suv", "hatchback", "wagon", "minivan", "truck"}:
        items.append("Useful cargo space")
    if safety >= 86:
        items.append("Good safety fit")
    items.append(f"Real used-market data from Kaggle")
    return items[:4]


def watchouts(make, family, body, transmission, mileage, price):
    items = []
    if mileage > 100000:
        items.append("Inspect higher-mileage wear carefully")
    if transmission == "CVT":
        items.append("Confirm CVT service history")
    if body in {"suv", "truck", "minivan", "wagon"}:
        items.append("Budget for tires and suspension wear")
    if body in {"coupe", "convertible"}:
        items.append("Check insurance quotes before committing")
    if price > 20000:
        items.append("Price may stretch a first-car budget")
    items.append("Verify safety and recall history before buying")
    return items[:3]


def common_issues(make, family, body, transmission):
    issues = ["Wear items vary by listing condition"]
    if transmission == "CVT":
        issues.append("CVT fluid service sensitivity")
    if body in {"suv", "truck", "minivan", "wagon"}:
        issues.append("Tire and suspension costs")
    if make == "Subaru":
        issues.append("Tire matching matters for AWD")
    if make in {"Hyundai", "Kia"}:
        issues.append("Check recalls and insurance eligibility")
    return issues[:4]


def portfolio_score(vehicle):
    return (
        vehicle["reliabilityScore"] * 0.28
        + vehicle["safetyScore"] * 0.2
        + min(100, vehicle["mpg"] * 2.4) * 0.16
        + max(0, 100 - vehicle["price"] / 250) * 0.18
        + vehicle["resaleScore"] * 0.1
        + vehicle["cargoScore"] * 0.08
    )


def estimate_ev_price(make, body, row):
    battery = parse_float(row.get("battery_capacity_kWh")) or 45
    base = 27500 + battery * 310
    if body == "suv":
        base += 3500
    if make in {"Hyundai", "Kia", "Nissan", "Chevrolet"}:
        base -= 3500
    if make in {"Ford", "Volkswagen"}:
        base -= 1500
    return int(round(max(24000, min(52000, base))))


def select_balanced(vehicles, limit=320):
    ranked = sorted(
        vehicles,
        key=lambda vehicle: (
            -portfolio_score(vehicle),
            vehicle["price"],
            vehicle["make"],
            vehicle["model"],
            -vehicle["year"],
        ),
    )
    selected = []
    selected_ids = set()

    def add(vehicle):
        if vehicle["id"] in selected_ids:
            return False
        selected.append(vehicle)
        selected_ids.add(vehicle["id"])
        return True

    def add_where(predicate, quota):
        count = 0
        for vehicle in ranked:
            if len(selected) >= limit:
                break
            if count >= quota:
                break
            if predicate(vehicle) and add(vehicle):
                count += 1

    body_quotas = {
        "sedan": 36,
        "hatchback": 36,
        "suv": 42,
        "truck": 32,
        "wagon": 24,
        "minivan": 18,
        "coupe": 22,
        "convertible": 10,
    }
    for body, quota in body_quotas.items():
        add_where(lambda vehicle, body=body: vehicle["bodyType"] == body, quota)

    add_where(lambda vehicle: vehicle["transmission"] == "manual", 28)
    add_where(lambda vehicle: vehicle["drivetrain"] in {"AWD", "4WD"}, 36)
    add_where(lambda vehicle: vehicle["fuelType"] == "electric", 18)
    add_where(lambda vehicle: vehicle["year"] >= 2023, 28)

    for vehicle in ranked:
        if len(selected) >= limit:
            break
        add(vehicle)

    return selected


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    specs = read_specs()
    vehicles = select_balanced(
        read_craigslist(specs)
        + read_usedcarscatalog(specs)
        + read_2023_model_vehicles(specs)
        + read_ev_model_vehicles(specs)
    )
    with OUT.open("w", encoding="utf-8") as handle:
        json.dump(vehicles, handle, indent=2)
        handle.write("\n")
    with REPORT.open("w", encoding="utf-8") as handle:
        json.dump(
            {
                "generatedAt": date.today().isoformat(),
                "generatedFrom": [
                    "data/raw/craigslist-carstrucks-data/vehicles.csv",
                    "data/raw/car-features-msrp/data.csv",
                    "data/raw/usedcarscatalog/cars.csv",
                    "data/raw/2023-car-model-dataset/Car_Models.csv",
                    "data/raw/electric-vehicle-specs-2025/electric_vehicles_spec_2025.csv.csv",
                ],
                "vehicleCount": len(vehicles),
                "notes": [
                    "Craigslist provides US used prices, mileage, listing URLs, image URLs, drivetrain, fuel, and transmission.",
                    "CooperUnion cardataset enriches MPG, MSRP, horsepower, driven wheels, and body style where model/year matches.",
                    "Used-cars-catalog adds manual, AWD/4WD, wagon, minivan, and additional used-market coverage.",
                    "2023 model and 2025 EV specification datasets add newer/current-model coverage where used listings are sparse.",
                    "The processed catalog is balanced by body style, drivetrain, transmission, EV, and newer-year coverage to reduce no-match cases.",
                    "Safety and reliability are conservative heuristics until dedicated safety/reliability overlays are connected.",
                ],
            },
            handle,
            indent=2,
        )
        handle.write("\n")
    print(f"Wrote {len(vehicles)} vehicles to {OUT}")


if __name__ == "__main__":
    main()
