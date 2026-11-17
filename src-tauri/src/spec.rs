//! Parseo, validación y conversión de especificaciones OpenAPI / Swagger.
//!
//! Todo lo que no depende de Tauri vive aquí para poder probarlo con `cargo test`.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const HTTP_METHODS: [&str; 8] = [
    "get", "put", "post", "delete", "options", "head", "patch", "trace",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Json,
    Yaml,
}

impl Format {
    /// Formato según la extensión del archivo, si es reconocible.
    pub fn from_path(path: &Path) -> Option<Format> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "json" => Some(Format::Json),
            "yaml" | "yml" => Some(Format::Yaml),
            _ => None,
        }
    }

    /// Adivina el formato a partir del contenido.
    pub fn sniff(content: &str) -> Format {
        match content.trim_start().chars().next() {
            Some('{') | Some('[') => Format::Json,
            _ => Format::Yaml,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SyntaxError {
    pub message: String,
    /// Línea (base 1) donde se detectó el error.
    pub line: Option<usize>,
    /// Columna (base 1) donde se detectó el error.
    pub column: Option<usize>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    pub severity: Severity,
    pub message: String,
    /// JSON Pointer (RFC 6901) del nodo afectado, p. ej. `/paths/~1pets/get`.
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpecInfo {
    /// "OpenAPI 3.1.0", "Swagger 2.0"… `None` si no se reconoce.
    pub kind: Option<String>,
    pub title: Option<String>,
    pub version: Option<String>,
    pub operations: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub format: Format,
    pub spec: Option<Value>,
    pub syntax_error: Option<SyntaxError>,
    pub issues: Vec<Issue>,
    pub info: Option<SpecInfo>,
}

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

pub fn parse(content: &str, format: Format) -> Result<Value, SyntaxError> {
    match format {
        Format::Json => serde_json::from_str::<Value>(content).map_err(|e| SyntaxError {
            message: json_error_message(&e),
            line: Some(e.line()),
            column: Some(e.column()),
        }),
        Format::Yaml => {
            let mut value: serde_yaml::Value =
                serde_yaml::from_str(content).map_err(|e| SyntaxError {
                    line: e.location().map(|l| l.line()),
                    column: e.location().map(|l| l.column()),
                    message: yaml_error_message(&e),
                })?;
            value.apply_merge().map_err(|e| SyntaxError {
                message: format!("Error al aplicar claves de fusión (<<): {e}"),
                line: None,
                column: None,
            })?;
            yaml_to_json(value).map_err(|message| SyntaxError {
                message,
                line: None,
                column: None,
            })
        }
    }
}

fn json_error_message(e: &serde_json::Error) -> String {
    // serde_json añade " at line X column Y"; lo quitamos porque ya lo mostramos aparte.
    let msg = e.to_string();
    match msg.rfind(" at line ") {
        Some(idx) => msg[..idx].to_string(),
        None => msg,
    }
}

fn yaml_error_message(e: &serde_yaml::Error) -> String {
    let msg = e.to_string();
    match msg.find(" at line ") {
        Some(idx) => msg[..idx].to_string(),
        None => msg,
    }
}

/// Convierte un valor YAML a JSON. A diferencia de deserializar directamente a
/// `serde_json::Value`, acepta claves numéricas o booleanas (`200:` en `responses`)
/// convirtiéndolas a texto, tal como hace Swagger.
fn yaml_to_json(value: serde_yaml::Value) -> Result<Value, String> {
    use serde_yaml::Value as Y;
    Ok(match value {
        Y::Null => Value::Null,
        Y::Bool(b) => Value::Bool(b),
        Y::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::from(i)
            } else if let Some(u) = n.as_u64() {
                Value::from(u)
            } else {
                n.as_f64()
                    .and_then(serde_json::Number::from_f64)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            }
        }
        Y::String(s) => Value::String(s),
        Y::Sequence(seq) => Value::Array(
            seq.into_iter()
                .map(yaml_to_json)
                .collect::<Result<Vec<_>, _>>()?,
        ),
        Y::Mapping(map) => {
            let mut out = Map::with_capacity(map.len());
            for (k, v) in map {
                out.insert(yaml_key_to_string(k)?, yaml_to_json(v)?);
            }
            Value::Object(out)
        }
        Y::Tagged(tagged) => yaml_to_json(tagged.value)?,
    })
}

fn yaml_key_to_string(key: serde_yaml::Value) -> Result<String, String> {
    use serde_yaml::Value as Y;
    match key {
        Y::String(s) => Ok(s),
        Y::Number(n) => Ok(n.to_string()),
        Y::Bool(b) => Ok(b.to_string()),
        Y::Null => Ok("null".to_string()),
        Y::Tagged(t) => yaml_key_to_string(t.value),
        Y::Sequence(_) | Y::Mapping(_) => {
            Err("Las claves de un mapa deben ser valores simples (texto o número)".to_string())
        }
    }
}

// ---------------------------------------------------------------------------
// Serialización / conversión
// ---------------------------------------------------------------------------

pub fn serialize(value: &Value, format: Format) -> Result<String, String> {
    match format {
        Format::Json => serde_json::to_string_pretty(value)
            .map(|mut s| {
                s.push('\n');
                s
            })
            .map_err(|e| e.to_string()),
        Format::Yaml => serde_yaml::to_string(value).map_err(|e| e.to_string()),
    }
}

pub fn convert(content: &str, from: Format, to: Format) -> Result<String, String> {
    let value = parse(content, from).map_err(|e| describe_syntax_error(&e))?;
    serialize(&value, to)
}

pub fn describe_syntax_error(e: &SyntaxError) -> String {
    match (e.line, e.column) {
        (Some(l), Some(c)) => format!("{} (línea {l}, columna {c})", e.message),
        (Some(l), None) => format!("{} (línea {l})", e.message),
        _ => e.message.clone(),
    }
}

// ---------------------------------------------------------------------------
// Análisis completo
// ---------------------------------------------------------------------------

pub fn analyze(content: &str, format: Format) -> Analysis {
    if content.trim().is_empty() {
        return Analysis {
            format,
            spec: None,
            syntax_error: None,
            issues: vec![issue(Severity::Error, "El documento está vacío", "")],
            info: None,
        };
    }

    match parse(content, format) {
        Err(err) => Analysis {
            format,
            spec: None,
            syntax_error: Some(err),
            issues: Vec::new(),
            info: None,
        },
        Ok(spec) => {
            let (info, issues) = validate(&spec);
            Analysis {
                format,
                spec: Some(spec),
                syntax_error: None,
                issues,
                info,
            }
        }
    }
}

fn issue(severity: Severity, message: impl Into<String>, path: impl Into<String>) -> Issue {
    Issue {
        severity,
        message: message.into(),
        path: path.into(),
    }
}

fn escape_pointer(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

fn child(path: &str, segment: &str) -> String {
    format!("{path}/{}", escape_pointer(segment))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Dialect {
    Swagger2,
    OpenApi30,
    OpenApi31,
    Unknown,
}

/// Valida la estructura básica de la especificación. No pretende ser un validador
/// completo del esquema, sino detectar los errores más comunes al editar a mano.
pub fn validate(spec: &Value) -> (Option<SpecInfo>, Vec<Issue>) {
    let mut issues = Vec::new();

    let Some(root) = spec.as_object() else {
        issues.push(issue(
            Severity::Error,
            "La raíz del documento debe ser un objeto",
            "",
        ));
        return (None, issues);
    };

    let mut info = SpecInfo::default();

    // --- Versión -----------------------------------------------------------
    let dialect = if let Some(v) = root.get("openapi") {
        let version = scalar_to_string(v);
        info.kind = Some(format!("OpenAPI {version}"));
        if !v.is_string() {
            issues.push(issue(
                Severity::Warning,
                "`openapi` debería ser texto, p. ej. \"3.0.3\"",
                "/openapi",
            ));
        }
        if version.starts_with("3.0") {
            Dialect::OpenApi30
        } else if version.starts_with("3.1") || version.starts_with("3.2") {
            Dialect::OpenApi31
        } else {
            issues.push(issue(
                Severity::Warning,
                format!("Versión de OpenAPI no reconocida: {version}"),
                "/openapi",
            ));
            Dialect::Unknown
        }
    } else if let Some(v) = root.get("swagger") {
        let version = scalar_to_string(v);
        info.kind = Some(format!("Swagger {version}"));
        if version != "2.0" {
            issues.push(issue(
                Severity::Error,
                format!("`swagger` debe ser \"2.0\" (se encontró {version})"),
                "/swagger",
            ));
        }
        Dialect::Swagger2
    } else {
        issues.push(issue(
            Severity::Error,
            "Falta el campo `openapi` (OpenAPI 3) o `swagger` (Swagger 2.0)",
            "",
        ));
        Dialect::Unknown
    };

    // --- info --------------------------------------------------------------
    match root.get("info") {
        None => issues.push(issue(Severity::Error, "Falta el objeto `info`", "/info")),
        Some(Value::Object(obj)) => {
            match obj.get("title") {
                Some(Value::String(t)) => info.title = Some(t.clone()),
                Some(_) => issues.push(issue(
                    Severity::Warning,
                    "`info.title` debería ser texto",
                    "/info/title",
                )),
                None => issues.push(issue(
                    Severity::Error,
                    "Falta `info.title`",
                    "/info/title",
                )),
            }
            match obj.get("version") {
                Some(Value::String(v)) => info.version = Some(v.clone()),
                Some(v @ Value::Number(_)) => {
                    info.version = Some(v.to_string());
                    issues.push(issue(
                        Severity::Warning,
                        "`info.version` debería ser texto; ponlo entre comillas",
                        "/info/version",
                    ));
                }
                Some(_) => issues.push(issue(
                    Severity::Warning,
                    "`info.version` debería ser texto",
                    "/info/version",
                )),
                None => issues.push(issue(
                    Severity::Error,
                    "Falta `info.version`",
                    "/info/version",
                )),
            }
        }
        Some(_) => issues.push(issue(
            Severity::Error,
            "`info` debe ser un objeto",
            "/info",
        )),
    }

    // --- paths ---------------------------------------------------------------
    let paths_optional = dialect == Dialect::OpenApi31
        && (root.contains_key("webhooks") || root.contains_key("components"));
    match root.get("paths") {
        None if !paths_optional => {
            issues.push(issue(Severity::Error, "Falta el objeto `paths`", "/paths"))
        }
        None => {}
        Some(Value::Object(paths)) => {
            info.operations = check_paths(spec, paths, dialect, &mut issues);
        }
        Some(_) => issues.push(issue(
            Severity::Error,
            "`paths` debe ser un objeto",
            "/paths",
        )),
    }

    // --- Referencias -------------------------------------------------------
    check_refs(spec, spec, "", &mut issues);

    (Some(info), issues)
}

fn scalar_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Revisa rutas y operaciones. Devuelve el número de operaciones encontradas.
fn check_paths(
    spec: &Value,
    paths: &Map<String, Value>,
    dialect: Dialect,
    issues: &mut Vec<Issue>,
) -> usize {
    let mut operations = 0;
    let mut operation_ids: HashMap<String, String> = HashMap::new();

    for (route, item) in paths {
        let route_ptr = child("/paths", route);

        if route.starts_with("x-") {
            continue;
        }
        if !route.starts_with('/') {
            issues.push(issue(
                Severity::Error,
                format!("La ruta \"{route}\" debe empezar con /"),
                route_ptr.clone(),
            ));
        }

        let Some(item) = item.as_object() else {
            if !item.is_null() {
                issues.push(issue(
                    Severity::Error,
                    format!("La ruta \"{route}\" debe ser un objeto"),
                    route_ptr,
                ));
            }
            continue;
        };

        let template_params = path_template_params(route);
        let path_level = declared_path_params(spec, item.get("parameters"));

        for method in HTTP_METHODS {
            let Some(op) = item.get(method) else { continue };
            operations += 1;
            let op_ptr = child(&route_ptr, method);
            let Some(op) = op.as_object() else {
                issues.push(issue(
                    Severity::Error,
                    format!("La operación {} {route} debe ser un objeto", method.to_uppercase()),
                    op_ptr,
                ));
                continue;
            };

            // operationId duplicado
            if let Some(Value::String(id)) = op.get("operationId") {
                if let Some(previous) = operation_ids.get(id) {
                    issues.push(issue(
                        Severity::Error,
                        format!("operationId \"{id}\" duplicado (también en {previous})"),
                        child(&op_ptr, "operationId"),
                    ));
                } else {
                    operation_ids.insert(
                        id.clone(),
                        format!("{} {route}", method.to_uppercase()),
                    );
                }
            }

            // responses
            match op.get("responses") {
                None => issues.push(issue(
                    if dialect == Dialect::OpenApi31 {
                        Severity::Warning
                    } else {
                        Severity::Error
                    },
                    format!("{} {route} no define `responses`", method.to_uppercase()),
                    op_ptr.clone(),
                )),
                Some(Value::Object(r)) if r.is_empty() => issues.push(issue(
                    Severity::Warning,
                    format!("{} {route} no tiene ninguna respuesta", method.to_uppercase()),
                    child(&op_ptr, "responses"),
                )),
                _ => {}
            }

            // parámetros de ruta declarados
            let mut declared = path_level.clone();
            declared.extend(declared_path_params(spec, op.get("parameters")));
            for name in &template_params {
                if !declared.contains(name) {
                    issues.push(issue(
                        Severity::Error,
                        format!(
                            "{} {route}: falta declarar el parámetro de ruta `{name}` (in: path)",
                            method.to_uppercase()
                        ),
                        op_ptr.clone(),
                    ));
                }
            }
        }
    }

    operations
}

/// Nombres entre llaves de una plantilla de ruta: `/pets/{petId}` → `petId`.
fn path_template_params(route: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = route;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else { break };
        let name = after[..end].trim();
        if !name.is_empty() && !out.iter().any(|n| n == name) {
            out.push(name.to_string());
        }
        rest = &after[end + 1..];
    }
    out
}

fn declared_path_params(spec: &Value, params: Option<&Value>) -> HashSet<String> {
    let mut out = HashSet::new();
    let Some(Value::Array(params)) = params else {
        return out;
    };
    for p in params {
        let p = match p.get("$ref").and_then(Value::as_str) {
            Some(r) => match resolve_local_ref(spec, r) {
                Some(target) => target,
                None => continue,
            },
            None => p,
        };
        if p.get("in").and_then(Value::as_str) == Some("path") {
            if let Some(name) = p.get("name").and_then(Value::as_str) {
                out.insert(name.to_string());
            }
        }
    }
    out
}

/// Resuelve una referencia local (`#/components/schemas/Pet`).
fn resolve_local_ref<'a>(spec: &'a Value, reference: &str) -> Option<&'a Value> {
    let pointer = reference.strip_prefix('#')?;
    if pointer.is_empty() {
        return Some(spec);
    }
    spec.pointer(&percent_decode(pointer))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi << 4 | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

fn check_refs(spec: &Value, node: &Value, path: &str, issues: &mut Vec<Issue>) {
    match node {
        Value::Object(map) => {
            if let Some(Value::String(reference)) = map.get("$ref") {
                let ref_ptr = child(path, "$ref");
                if reference.starts_with('#') {
                    if resolve_local_ref(spec, reference).is_none() {
                        issues.push(issue(
                            Severity::Error,
                            format!("Referencia no encontrada: {reference}"),
                            ref_ptr,
                        ));
                    }
                } else {
                    issues.push(issue(
                        Severity::Warning,
                        format!("Referencia externa ({reference}): la vista previa no puede resolverla"),
                        ref_ptr,
                    ));
                }
            }
            for (key, value) in map {
                // Los ejemplos son datos libres: pueden contener claves `$ref` literales.
                // `examples` como mapa (OpenAPI 3) sí puede tener referencias reales.
                if key == "example" || (key == "examples" && !value.is_object()) {
                    continue;
                }
                check_refs(spec, value, &child(path, key), issues);
            }
        }
        Value::Array(items) => {
            for (i, value) in items.iter().enumerate() {
                check_refs(spec, value, &format!("{path}/{i}"), issues);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PETSTORE_YAML: &str = r#"openapi: 3.0.3
info:
  title: Petstore
  version: "1.0.0"
paths:
  /pets/{petId}:
    get:
      operationId: getPet
      parameters:
        - $ref: '#/components/parameters/PetId'
      responses:
        200:
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
components:
  parameters:
    PetId:
      name: petId
      in: path
      required: true
      schema: { type: string }
  schemas:
    Pet:
      type: object
      properties:
        id: { type: integer }
"#;

    #[test]
    fn sniffs_and_detects_format() {
        assert_eq!(Format::sniff("  {\"a\":1}"), Format::Json);
        assert_eq!(Format::sniff("openapi: 3.0.0"), Format::Yaml);
        assert_eq!(Format::from_path(Path::new("a/b.YML")), Some(Format::Yaml));
        assert_eq!(Format::from_path(Path::new("x.json")), Some(Format::Json));
        assert_eq!(Format::from_path(Path::new("x.txt")), None);
    }

    #[test]
    fn valid_yaml_has_no_issues() {
        let a = analyze(PETSTORE_YAML, Format::Yaml);
        assert!(a.syntax_error.is_none());
        assert!(a.issues.is_empty(), "{:?}", a.issues);
        let info = a.info.unwrap();
        assert_eq!(info.kind.as_deref(), Some("OpenAPI 3.0.3"));
        assert_eq!(info.title.as_deref(), Some("Petstore"));
        assert_eq!(info.operations, 1);
        // la clave numérica 200 se convierte a texto
        assert!(a.spec.unwrap().pointer("/paths/~1pets~1{petId}/get/responses/200").is_some());
    }

    #[test]
    fn yaml_syntax_error_has_location() {
        let err = parse("openapi: 3.0.0\ninfo:\n  title: [sin cerrar\n", Format::Yaml).unwrap_err();
        assert!(err.line.is_some());
        assert!(!err.message.contains(" at line "));
    }

    #[test]
    fn json_syntax_error_has_location() {
        let err = parse("{\n  \"a\": 1,\n}", Format::Json).unwrap_err();
        assert_eq!(err.line, Some(3));
        assert!(err.column.is_some());
    }

    #[test]
    fn converts_both_ways_preserving_order() {
        let json = convert(PETSTORE_YAML, Format::Yaml, Format::Json).unwrap();
        let openapi = json.find("\"openapi\"").unwrap();
        let info = json.find("\"info\"").unwrap();
        let paths = json.find("\"paths\"").unwrap();
        assert!(openapi < info && info < paths);

        let yaml = convert(&json, Format::Json, Format::Yaml).unwrap();
        assert!(yaml.starts_with("openapi: 3.0.3"));
        assert_eq!(
            parse(&yaml, Format::Yaml).unwrap(),
            parse(&json, Format::Json).unwrap()
        );
    }

    #[test]
    fn detects_common_mistakes() {
        let src = r#"
openapi: 3.0.0
info:
  title: Demo
  version: 1.0
paths:
  /users/{id}:
    get:
      operationId: getUser
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Missing'
  users:
    post:
      operationId: getUser
"#;
        let a = analyze(src, Format::Yaml);
        let messages: Vec<&str> = a.issues.iter().map(|i| i.message.as_str()).collect();
        let has = |needle: &str| messages.iter().any(|m| m.contains(needle));
        assert!(has("info.version"), "{messages:?}");
        assert!(has("falta declarar el parámetro de ruta `id`"), "{messages:?}");
        assert!(has("Referencia no encontrada"), "{messages:?}");
        assert!(has("debe empezar con /"), "{messages:?}");
        assert!(has("duplicado"), "{messages:?}");
        assert!(has("no define `responses`"), "{messages:?}");
    }

    #[test]
    fn swagger2_is_recognized() {
        let a = analyze(
            r#"{"swagger":"2.0","info":{"title":"A","version":"1"},"paths":{}}"#,
            Format::Json,
        );
        assert_eq!(a.info.unwrap().kind.as_deref(), Some("Swagger 2.0"));
        assert!(a.issues.is_empty());
    }

    #[test]
    fn missing_version_field_is_error() {
        let a = analyze("info:\n  title: A\n  version: '1'\npaths: {}\n", Format::Yaml);
        assert!(a.info.unwrap().kind.is_none());
        assert!(a.issues.iter().any(|i| i.severity == Severity::Error));
    }

    #[test]
    fn empty_document() {
        let a = analyze("   \n", Format::Yaml);
        assert!(a.spec.is_none());
        assert_eq!(a.issues.len(), 1);
    }

    #[test]
    fn yaml_merge_keys_are_applied() {
        let src = "base: &b\n  a: 1\nderived:\n  <<: *b\n  c: 2\n";
        let v = parse(src, Format::Yaml).unwrap();
        assert_eq!(v.pointer("/derived/a"), Some(&Value::from(1)));
    }

    #[test]
    fn percent_encoded_refs_resolve() {
        let spec: Value = serde_json::json!({"paths": {"/a/{id}": {"x": 1}}});
        assert!(resolve_local_ref(&spec, "#/paths/~1a~1%7Bid%7D/x").is_some());
    }
}
