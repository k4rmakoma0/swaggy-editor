export const NEW_API_YAML = `openapi: 3.0.3
info:
  title: Mi API
  description: Describe aquí tu API.
  version: "1.0.0"
servers:
  - url: https://api.ejemplo.com/v1
tags:
  - name: usuarios
    description: Gestión de usuarios
paths:
  /usuarios:
    get:
      tags: [usuarios]
      summary: Lista los usuarios
      operationId: listarUsuarios
      parameters:
        - name: limite
          in: query
          description: Número máximo de resultados
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
      responses:
        "200":
          description: Lista de usuarios
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Usuario"
    post:
      tags: [usuarios]
      summary: Crea un usuario
      operationId: crearUsuario
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/NuevoUsuario"
      responses:
        "201":
          description: Usuario creado
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Usuario"
        "400":
          $ref: "#/components/responses/Error"
  /usuarios/{id}:
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    get:
      tags: [usuarios]
      summary: Obtiene un usuario
      operationId: obtenerUsuario
      responses:
        "200":
          description: El usuario
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Usuario"
        "404":
          $ref: "#/components/responses/Error"
components:
  schemas:
    NuevoUsuario:
      type: object
      required: [nombre, email]
      properties:
        nombre:
          type: string
          example: Ada Lovelace
        email:
          type: string
          format: email
          example: ada@ejemplo.com
    Usuario:
      allOf:
        - $ref: "#/components/schemas/NuevoUsuario"
        - type: object
          required: [id]
          properties:
            id:
              type: string
              format: uuid
            creado:
              type: string
              format: date-time
    Error:
      type: object
      properties:
        codigo:
          type: integer
        mensaje:
          type: string
  responses:
    Error:
      description: Error
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
`;
