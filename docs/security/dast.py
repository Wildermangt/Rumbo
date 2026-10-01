"""
Pruebas dinámicas de seguridad (DAST) NO destructivas contra la instancia local.
Solo lee/crea tareas de prueba; no borra datos ni ataca servicios de terceros.
"""
import json, base64, time, urllib.parse, sys
import requests

BASE = "http://localhost:8080/api"
DIRECT = "http://localhost:3000/api"
results = []

def rec(cid, name, category, severity, status, detail, evidence=""):
    results.append(dict(id=cid, name=name, category=category, severity=severity,
                        status=status, detail=detail, evidence=str(evidence)[:600]))
    print(f"[{status:5}] {cid} {name}")

def login(u="admin", p="admin123"):
    r = requests.post(f"{BASE}/auth/login", json={"username": u, "password": p}, timeout=10)
    return r

# ---- preparar token válido ----
tok = login().json()["data"]["token"]
H = {"Authorization": f"Bearer {tok}"}

def b64url(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

# A01 — Autorización rota: acceso sin token
r = requests.get(f"{BASE}/tasks")
rec("DAST-01", "Endpoint protegido sin token", "A01 Broken Access Control", "alta",
    "PASS" if r.status_code == 401 else "FAIL",
    "GET /tasks sin Authorization debe devolver 401.", f"HTTP {r.status_code}")

# A01 — token con firma inválida
bad = tok.rsplit(".", 1)[0] + ".AAAAinvalidsignature"
r = requests.get(f"{BASE}/tasks", headers={"Authorization": f"Bearer {bad}"})
rec("DAST-02", "JWT con firma manipulada", "A01/A02", "alta",
    "PASS" if r.status_code == 401 else "FAIL",
    "Un JWT con firma alterada debe rechazarse.", f"HTTP {r.status_code}")

# A02 — alg:none (JWT sin firma)
h = b64url({"alg": "none", "typ": "JWT"}); pl = b64url({"sub": "admin", "role": "admin"})
none_tok = f"{h}.{pl}."
r = requests.get(f"{BASE}/tasks", headers={"Authorization": f"Bearer {none_tok}"})
rec("DAST-03", "JWT alg:none (bypass de firma)", "A02 Cryptographic Failures", "critica",
    "PASS" if r.status_code == 401 else "FAIL",
    "El servidor debe fijar algorithms=['HS256'] y rechazar alg:none.", f"HTTP {r.status_code}")

# A02 — confusión HS256 firmado con secreto débil conocido (default de compose)
try:
    import jwt as pyjwt
    forged = pyjwt.encode({"sub": "admin", "role": "admin", "iss": "tasks-api"},
                          "dev-only-secret-change-me-please-0123456789abcdef", algorithm="HS256")
    r = requests.get(f"{BASE}/tasks", headers={"Authorization": f"Bearer {forged}"})
    ok = r.status_code == 200
    rec("DAST-04", "JWT falsificado con el secreto por defecto", "A02/A05", "critica",
        "FAIL" if ok else "PASS",
        "Si el despliegue usa el JWT_SECRET por defecto, cualquiera puede firmar tokens válidos. "
        "Debe configurarse un secreto propio en producción.",
        f"HTTP {r.status_code} (token aceptado={ok})")
except Exception as e:
    rec("DAST-04", "JWT falsificado con el secreto por defecto", "A02/A05", "critica", "INFO",
        "No se pudo probar (PyJWT no disponible).", e)

# A07 — fuerza bruta / rate limiting en login
codes = []
for i in range(25):
    codes.append(login("admin", "mala"+str(i)).status_code)
rec("DAST-05", "Rate limiting en /auth/login", "A07 Auth Failures", "media",
    "PASS" if 429 in codes else "FAIL",
    "Tras varios intentos fallidos debe aparecer 429.",
    f"429 visto={429 in codes}; últimos={codes[-5:]}")

# A07 — enumeración de usuarios (timing / mensaje)
r1 = login("admin", "x"); r2 = login("noexiste", "x")
same = r1.json().get("error", {}).get("code") == r2.json().get("error", {}).get("code")
rec("DAST-06", "Enumeración de usuarios en login", "A07", "baja",
    "PASS" if same else "WARN",
    "El mensaje de error no debe revelar si el usuario existe.",
    f"code usuario-ok={r1.json().get('error',{}).get('code')} / usuario-inexistente={r2.json().get('error',{}).get('code')}")

# espera a que se libere la ventana de rate limit para el resto
time.sleep(2)

# A03 — Inyección SQL en parámetros
payloads = ["PENDING' OR '1'='1", "'; DROP TABLE Tasks;--", "PENDING) OR 1=1--", "1;WAITFOR DELAY '0:0:5'--"]
sqli_ok = True; ev = []
for p in payloads:
    r = requests.get(f"{BASE}/tasks", params={"status": p, "page": 1, "pageSize": 5}, headers=H)
    ev.append(f"{p!r}->{r.status_code}")
    # Debe rechazarse por validación (400). Nunca 500 ni 200 con datos.
    if r.status_code not in (400,):
        sqli_ok = False
rec("DAST-07", "Inyección SQL en query 'status'", "A03 Injection", "critica",
    "PASS" if sqli_ok else "FAIL",
    "Los payloads SQL deben rechazarse por validación (400), no ejecutarse.", "; ".join(ev))

# A03 — SQLi basada en tiempo en el body (title)
t0 = time.time()
r = requests.post(f"{BASE}/tasks", json={"title": "a'; WAITFOR DELAY '0:0:5'--"}, headers=H)
dt = time.time() - t0
# title <=150 se inserta como literal vía parámetro; no debe tardar 5s ni dar 500
rec("DAST-08", "SQLi basada en tiempo en 'title'", "A03", "critica",
    "PASS" if dt < 3 and r.status_code in (201, 400) else "FAIL",
    "El valor viaja como parámetro del SP; no debe ejecutarse como SQL.",
    f"HTTP {r.status_code} en {dt:.2f}s")

# A03 — XSS almacenado: el payload se guarda tal cual pero la API no lo ejecuta (el front usa binding seguro)
xss = "<img src=x onerror=alert(1)>"
r = requests.post(f"{BASE}/tasks", json={"title": xss}, headers=H)
stored = r.json().get("data", {}).get("title") if r.status_code == 201 else None
rec("DAST-09", "Payload XSS almacenado (defensa en el front)", "A03 XSS", "media",
    "PASS" if stored == xss else "WARN",
    "La API almacena texto plano; Vue escapa por defecto con interpolación (sin v-html). "
    "Riesgo si en el futuro se renderiza con v-html.",
    f"guardado={stored!r}")

# Validación estricta — campos no permitidos / tipos
r = requests.post(f"{BASE}/tasks", json={"title": "ok", "status": "COMPLETED", "isAdmin": True}, headers=H)
rec("DAST-10", "Mass assignment / campos extra", "A08 Integrity", "media",
    "PASS" if r.status_code == 400 else "FAIL",
    "El DTO estricto (Zod) debe rechazar campos no declarados como 'status' o 'isAdmin' en la creación.",
    f"HTTP {r.status_code}")

# Validación — límites
r = requests.post(f"{BASE}/tasks", json={"title": "x"*5000}, headers=H)
rec("DAST-11", "Límite de longitud en 'title'", "A03 Validation", "baja",
    "PASS" if r.status_code == 400 else "FAIL",
    "Títulos > 150 deben rechazarse.", f"HTTP {r.status_code}")

# Payload JSON gigante — límite de body
big = {"title": "a", "description": "A"*2_000_000}
try:
    r = requests.post(f"{BASE}/tasks", json=big, headers=H, timeout=15)
    rec("DAST-12", "Límite de tamaño del body (DoS)", "A05 Misconfig", "media",
        "PASS" if r.status_code in (400, 413) else "FAIL",
        "Un body enorme debe rechazarse (límite 100kb).", f"HTTP {r.status_code}")
except Exception as e:
    rec("DAST-12", "Límite de tamaño del body (DoS)", "A05 Misconfig", "media", "WARN", "Excepción.", e)

# A05 — Cabeceras de seguridad (Helmet en API y nginx en el front)
r = requests.get(f"{BASE}/health")
hc = {k.lower(): v for k, v in r.headers.items()}
need = ["x-content-type-options", "x-frame-options"]
missing = [h for h in need if h not in hc]
rec("DAST-13", "Cabeceras de seguridad en la API", "A05 Security Misconfiguration", "media",
    "PASS" if not missing else "WARN",
    "Helmet debe añadir X-Content-Type-Options y X-Frame-Options.",
    f"presentes={[h for h in need if h in hc]} faltan={missing} xpb={hc.get('x-powered-by')}")

rf = requests.get("http://localhost:8080/")
hf = {k.lower(): v for k, v in rf.headers.items()}
missf = [h for h in ["x-content-type-options", "x-frame-options", "referrer-policy"] if h not in hf]
rec("DAST-14", "Cabeceras de seguridad en el frontend (nginx)", "A05", "baja",
    "PASS" if not missf else "WARN",
    "nginx debe enviar cabeceras de seguridad y ocultar su versión.",
    f"faltan={missf} server={hf.get('server')}")

# X-Powered-By oculto
rec("DAST-15", "Fingerprinting X-Powered-By", "A05", "baja",
    "PASS" if "x-powered-by" not in hc else "WARN",
    "Express debe ocultar la cabecera X-Powered-By.", f"x-powered-by={hc.get('x-powered-by')}")

# A05 — CORS
r = requests.get(f"{BASE}/health", headers={"Origin": "http://evil.example"})
acao = r.headers.get("Access-Control-Allow-Origin")
rec("DAST-16", "Política CORS", "A05", "media",
    "PASS" if acao in (None, "http://localhost:8080") else "WARN",
    "No debe reflejar orígenes arbitrarios. (En Docker el valor por defecto es http://localhost:8080).",
    f"ACAO={acao}")

# A09 — fuga de detalles de error (stack trace / JSON malformado)
r = requests.post(f"{BASE}/auth/login", data="{bad json", headers={"Content-Type": "application/json"})
leaked = "stack" in r.text.lower() or "at Object" in r.text or "node_modules" in r.text
rec("DAST-17", "Fuga de stack trace", "A09 Logging/Errors", "media",
    "PASS" if (r.status_code == 400 and not leaked) else "FAIL",
    "Un JSON malformado debe dar 400 uniforme, sin stack trace.", f"HTTP {r.status_code} leaked={leaked}")

# 404 uniforme (no revela framework)
r = requests.get(f"{BASE}/no-existe")
rec("DAST-18", "Formato uniforme en 404", "A09", "baja",
    "PASS" if (r.status_code == 404 and r.json().get("success") is False) else "WARN",
    "Las rutas inexistentes devuelven el formato de error estándar.", f"HTTP {r.status_code}")

# Métodos HTTP no permitidos
r = requests.request("DELETE", f"{BASE}/tasks/1")
rec("DAST-19", "Método HTTP no soportado", "A05", "baja",
    "PASS" if r.status_code in (401, 404, 405) else "WARN",
    "DELETE no está implementado; no debe exponer comportamiento inesperado.", f"HTTP {r.status_code}")

# IDOR / parámetro id no numérico
r = requests.patch(f"{BASE}/tasks/abc/status", json={"status": "PENDING"}, headers=H)
rec("DAST-20", "Validación de :id (no numérico)", "A01/A03", "baja",
    "PASS" if r.status_code == 400 else "FAIL",
    "El id debe validarse como entero positivo.", f"HTTP {r.status_code}")

# Exposición de puertos: backend accesible directamente (bypassea nginx y su rate-limit del front)
try:
    r = requests.get(f"{DIRECT}/health", timeout=5)
    rec("DAST-21", "Backend expuesto directamente en :3000", "A05 Misconfig", "media",
        "WARN" if r.status_code == 200 else "PASS",
        "El puerto 3000 se publica en el host. Útil para desarrollo, pero en producción el backend "
        "no debería exponerse fuera de la red interna de Docker.", f"HTTP {r.status_code}")
except Exception:
    rec("DAST-21", "Backend expuesto directamente en :3000", "A05 Misconfig", "media", "PASS",
        "El puerto 3000 no es accesible desde el host.", "sin respuesta")

# SQL Server expuesto en el host
import socket
s = socket.socket(); s.settimeout(3)
exposed = s.connect_ex(("127.0.0.1", 1433)) == 0; s.close()
rec("DAST-22", "SQL Server expuesto en :1433", "A05 Misconfig", "media",
    "WARN" if exposed else "PASS",
    "El puerto 1433 se publica en el host. En producción no debería exponerse; además el SA usa "
    "una contraseña por defecto en compose.", f"puerto abierto={exposed}")

# Content-Type incorrecto rechazado
r = requests.post(f"{BASE}/tasks", data="title=x", headers={**H, "Content-Type": "text/plain"})
rec("DAST-23", "Rechazo de Content-Type no JSON", "A03", "baja",
    "PASS" if r.status_code in (400, 415) else "WARN",
    "Los cuerpos no-JSON no deben parsearse como datos válidos.", f"HTTP {r.status_code}")

# TLS
rec("DAST-24", "Transporte cifrado (TLS)", "A02", "media", "WARN",
    "La app sirve HTTP en claro en local. En producción debe ir tras TLS (nginx/balanceador) "
    "y activar DB_ENCRYPT=true.", "esquema=http")

out = "docs/security/raw/dast-results.json"
json.dump(results, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
from collections import Counter
print("\nRESUMEN", dict(Counter(x["status"] for x in results)))
