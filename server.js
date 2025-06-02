const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const puerto = 5000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Conexión a MySQL
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '12345',
    database: 'provecta',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection()
    .then(connection => {
        console.log('✅ Conectado a la base de datos (Pool OK)');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Error al conectar a MySQL (Pool):', err);
    });

// Configuración de almacenamiento para imágenes de productos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public/uploads'));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
        cb(null, filename);
    }
});
const upload = multer({ storage });

// CONFIGURACIÓN DE MULTER PARA SUBIR IMÁGENES DE RESEÑAS
const storageResenas = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, 'uploads', 'resenas');
        // Crear directorio si no existe
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'resena-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadResenas = multer({
    storage: storageResenas,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB límite
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos de imagen (JPEG, PNG, GIF)'));
        }
    }
});

// MIDDLEWARE PARA SERVIR IMÁGENES DE RESEÑAS
app.use('/uploads/resenas', express.static(path.join(__dirname, 'uploads', 'resenas')));

// FUNCIÓN AUXILIAR PARA OCULTAR NOMBRES DE USUARIO
function ocultarNombreUsuario(nombre) {
    if (typeof nombre !== 'string' || nombre.trim().length < 3) {
        return 'Usuario';
    }

    const partes = nombre.trim().split(' ');
    return partes.map(parte => {
        if (parte.length <= 3) return parte;
        return parte.charAt(0) + '*'.repeat(parte.length - 2) + parte.charAt(parte.length - 1);
    }).join(' ');
}


// ==================== RUTAS DE USUARIOS ====================

// Registro de usuario
app.post('/registrar', async (req, res) => {
    const { nombre, contrasena, cedula, correo, telefono, rol } = req.body;
    if (!nombre || !contrasena || !cedula || !correo || !telefono || !rol) {
        return res.status(400).send('Faltan datos del formulario');
    }
    const sql = 'INSERT INTO usuarios (nombre, contrasena, cedula, correo, telefono, rol) VALUES (?, ?, ?, ?, ?, ?)';
    try {
        await db.execute(sql, [nombre, contrasena, cedula, correo, telefono, rol]);
        res.send('Usuario registrado con éxito');
    } catch (err) {
        console.error(err);
        return res.status(500).send('Error al registrar usuario');
    }
});

// Login
app.post('/login', async (req, res) => {
    const { correo, contrasena } = req.body;
    if (!correo || !contrasena) {
        return res.status(400).json({ success: false, message: 'Correo y contraseña requeridos' });
    }
    const sql = 'SELECT * FROM usuarios WHERE correo = ? AND contrasena = ?';
    try {
        const [resultados] = await db.execute(sql, [correo, contrasena]);
        if (resultados.length > 0) {
            const usuario = resultados[0];
            res.json({ success: true, id: usuario.id, nombre: usuario.nombre, rol: usuario.rol });
        } else {
            res.json({ success: false, message: 'Correo o contraseña incorrectos' });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
});

// Perfil de usuario
app.get('/perfil/:id', async (req, res) => {
    const id = req.params.id;
    const sql = 'SELECT nombre, correo, telefono, cedula, rol, imagen FROM usuarios WHERE id = ?';
    try {
        const [resultados] = await db.execute(sql, [id]);
        if (resultados.length > 0) {
            res.json({ success: true, usuario: resultados[0] });
        } else {
            res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

// Actualizar Perfil
app.post('/actualizar-perfil-completo/:id', upload.single('imagen'), async (req, res) => {
    const id = req.params.id;
    const { cedula, nombre, correo, telefono } = req.body;

    try {
        const [rows] = await db.query('SELECT imagen FROM usuarios WHERE id = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).send('Usuario no encontrado.');
        }

        let nuevaRutaImagen = rows[0].imagen;

        if (req.file) {
            nuevaRutaImagen = `/uploads/${req.file.filename}`;

            const imagenAnterior = rows[0].imagen;
            if (imagenAnterior && imagenAnterior !== '/uploads/default.png') {
                const rutaCompleta = path.join(__dirname, 'public', imagenAnterior);
                if (fs.existsSync(rutaCompleta)) {
                    fs.unlinkSync(rutaCompleta);
                }
            }
        }

        await db.query(
            `UPDATE usuarios SET cedula = ?, nombre = ?, correo = ?, telefono = ?, imagen = ? WHERE id = ?`,
            [cedula, nombre, correo, telefono, nuevaRutaImagen, id]
        );

        res.json({ success: true, message: 'Perfil actualizado correctamente.' });

    } catch (error) {
        console.error('Error actualizando perfil:', error);
        res.status(500).send('Error al actualizar el perfil.');
    }
});

// ==================== RUTAS DE PRODUCTOS ====================

// Crear producto
app.post('/api/productos', upload.array('imagenes', 3), async (req, res) => {
    const {
        nombre, descripcion, categoria, subcategoria, unidad_medida,
        minimo_pedido, tiempo_entrega, condiciones_pago,
        origen_producto, precio, stock, proveedor_id
    } = req.body;

    const imagenes = req.files;
    if (!imagenes || imagenes.length < 1) {
        return res.status(400).json({ success: false, message: 'Debes subir al menos una imagen' });
    }

    const imagen_principal = imagenes[0]?.filename || null;
    const imagen_secundaria1 = imagenes[1]?.filename || null;
    const imagen_secundaria2 = imagenes[2]?.filename || null;

    const sql = `
        INSERT INTO productos (
            nombre, descripcion, categoria, subcategoria, unidad_medida, minimo_pedido,
            tiempo_entrega, condiciones_pago, origen_producto, precio, stock, proveedor_id,
            imagen_principal, imagen_secundaria1, imagen_secundaria2
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
        const [resultado] = await db.execute(sql, [
            nombre, descripcion, categoria, subcategoria, unidad_medida, minimo_pedido,
            tiempo_entrega, condiciones_pago, origen_producto, precio, stock, proveedor_id,
            imagen_principal, imagen_secundaria1, imagen_secundaria2
        ]);
        res.json({ success: true, productoId: resultado.insertId });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Error al guardar producto' });
    }
});

// Editar producto
app.put('/api/productos/:id', upload.array('imagenes', 5), async (req, res) => {
    const id = req.params.id;
    const {
        nombre, descripcion, categoria, subcategoria, unidad_medida, minimo_pedido,
        tiempo_entrega, condiciones_pago, origen_producto, precio, stock, proveedor_id
    } = req.body;

    // Procesar hasta 3 imágenes si hay
    const imagenes = (req.files || []).slice(0, 3).map(file => file.filename);
    const hayImagenes = imagenes.length > 0;

    // Asegurar que siempre haya 3 valores (null si no hay suficientes)
    const imagenPrincipal = imagenes[0] || null;
    const imagenSecundaria1 = imagenes[1] || null;
    const imagenSecundaria2 = imagenes[2] || null;

    // Base de la consulta
    let sql = `
        UPDATE productos SET
            nombre = ?, descripcion = ?, categoria = ?, subcategoria = ?, unidad_medida = ?,
            minimo_pedido = ?, tiempo_entrega = ?, condiciones_pago = ?, origen_producto = ?,
            precio = ?, stock = ?, proveedor_id = ?
    `;

    const campos = [
        nombre, descripcion, categoria, subcategoria, unidad_medida,
        minimo_pedido, tiempo_entrega, condiciones_pago, origen_producto,
        precio, stock, proveedor_id
    ];

    // Agregar campos de imagen solo si hay imágenes nuevas
    if (hayImagenes) {
        sql += `,
            imagen_principal = ?, imagen_secundaria1 = ?, imagen_secundaria2 = ?
        `;
        campos.push(imagenPrincipal, imagenSecundaria1, imagenSecundaria2);
    }

    // WHERE al final
    sql += ` WHERE id = ?`;
    campos.push(id);

    try {
        await db.execute(sql, campos);
        res.json({ success: true, message: 'Producto actualizado correctamente' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Error al actualizar producto' });
    }
});



// Eliminar producto
app.delete('/api/productos/:id', async (req, res) => {
    const sql = 'DELETE FROM productos WHERE id = ?';
    try {
        await db.execute(sql, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false });
    }
});

// Obtener productos de un proveedor
app.get('/api/productos/proveedor/:proveedorId', async (req, res) => {
    const sql = 'SELECT * FROM productos WHERE proveedor_id = ?';
    try {
        const [resultados] = await db.execute(sql, [req.params.proveedorId]);
        res.json({ success: true, productos: resultados });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false });
    }
});

// Publicar producto
app.put('/api/productos/publicar/:id', async (req, res) => {
    const sql = 'UPDATE productos SET publicado = TRUE WHERE id = ?';
    try {
        await db.execute(sql, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false });
    }
});

// Retirar publicación de producto
app.put('/api/productos/retirar/:id', async (req, res) => {
    const sql = 'UPDATE productos SET publicado = FALSE WHERE id = ?';
    try {
        await db.execute(sql, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false });
    }
});

// Obtener todos los productos publicados
app.get('/api/productos/publicados', async (req, res) => {
    const sql = `
        SELECT
            p.id, p.nombre, p.descripcion, p.precio, p.imagen_principal,
            p.minimo_pedido, p.tiempo_entrega, p.condiciones_pago, p.categoria,
            u.nombre AS proveedor_nombre
        FROM productos p
        JOIN usuarios u ON p.proveedor_id = u.id
        WHERE p.publicado = TRUE
    `;
    try {
        const [resultados] = await db.execute(sql);
        res.json({ success: true, productos: resultados });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Error al obtener productos publicados' });
    }
});

// Vista detallada de un producto
app.get('/producto-detalle/:id', async (req, res) => {
    const { id } = req.params;
    const sql = `
    SELECT
        p.id,
        p.nombre,
        p.descripcion,
        p.categoria,
        p.subcategoria,
        p.unidad_medida,
        p.minimo_pedido,
        p.tiempo_entrega,
        p.condiciones_pago,
        p.origen_producto,
        p.precio,
        p.stock,
        p.proveedor_id,
        u.nombre AS proveedor_nombre,
        p.publicado,
        p.imagen_principal,
        p.imagen_secundaria1,
        p.imagen_secundaria2
    FROM productos p
    JOIN usuarios u ON p.proveedor_id = u.id
    WHERE p.id = ? `;

    try {
        const [resultados] = await db.execute(sql, [id]);
        if (resultados.length > 0) {
            res.json({ success: true, producto: resultados[0] });
        } else {
            res.status(404).json({ success: false, message: 'Producto no encontrado' });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

// Obtener un producto por ID
app.get('/api/productos/:id', async (req, res) => {
    const { id } = req.params;
    const sql = 'SELECT * FROM productos WHERE id = ?';
    try {
        const [resultados] = await db.execute(sql, [id]);
        if (resultados.length > 0) {
            res.json({ success: true, producto: resultados[0] });
        } else {
            res.status(404).json({ success: false, message: 'Producto no encontrado' });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

// Productos Relacionados
app.get('/productos-relacionados/:categoria/:id', async (req, res) => {
    const categoria = req.params.categoria;
    const id = req.params.id;

    const sql = `
        SELECT
            p.id,
            p.nombre,
            p.precio,
            p.imagen_principal,
            u.nombre AS proveedor_nombre
        FROM productos p
        JOIN usuarios u ON p.proveedor_id = u.id
        WHERE p.categoria = ? AND p.publicado = 1 AND p.id != ?
    `;

    try {
        const [resultados] = await db.execute(sql, [categoria, id]);
        res.json({ success: true, productos: resultados });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

// ==================== RUTAS DE RESEÑAS ====================

// ENDPOINT CORREGIDO PARA MANEJAR PRODUCTOS SIN RESEÑAS
app.get('/resenas/:productoId', async (req, res) => {
    console.log('=== INICIO ENDPOINT RESEÑAS ===');

    try {
        const { productoId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        console.log(`Producto ID: ${productoId}, Tipo: ${typeof productoId}`);
        console.log(`Página: ${page}, Límite: ${limit}, Offset: ${offset}`);

        // 1. Verificar que el producto existe
        console.log('Verificando si el producto existe...');
        const [productoCheck] = await db.execute(
            'SELECT id, nombre FROM productos WHERE id = ?',
            [productoId]
        );

        if (productoCheck.length === 0) {
            console.log(`❌ Producto ${productoId} no encontrado`);
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        console.log(`✅ Producto encontrado: ${productoCheck[0].nombre}`);

        // DEPURACIÓN: Verificar si existen reseñas SIN paginación
        console.log('🔍 DEPURACIÓN: Contando reseñas sin paginación...');
        const [conteoTotal] = await db.execute(
            'SELECT COUNT(*) as total FROM resenas WHERE producto_id = ?',
            [productoId]
        );
        console.log(`🔍 Total de reseñas en BD: ${conteoTotal[0].total}`);

        // Si no hay reseñas, el problema está aquí
        if (conteoTotal[0].total === 0) {
            console.log('🔍 PROBLEMA ENCONTRADO: No hay reseñas para este producto_id');

            // Verificar si el problema es el tipo de dato
            console.log('🔍 Verificando con conversión de tipo...');
            const [conteoConConversion] = await db.execute(
                'SELECT COUNT(*) as total FROM resenas WHERE producto_id = CAST(? AS UNSIGNED)',
                [productoId]
            );
            console.log(`🔍 Total con conversión: ${conteoConConversion[0].total}`);

            // Verificar qué producto_ids existen en la tabla resenas
            const [productosConResenas] = await db.execute(
                'SELECT DISTINCT producto_id FROM resenas LIMIT 10'
            );
            console.log('🔍 Productos con reseñas:', productosConResenas);
        }

        // 2. Obtener reseñas con paginación - CONSULTA CORREGIDA
        console.log('Obteniendo reseñas con paginación...');

        // IMPORTANTE: Usar interpolación para LIMIT y OFFSET, parámetro para WHERE
        const queryResenas = `
            SELECT 
                id,
                calificacion,
                comentario,
                fecha_creacion,
                usuario_nombre,
                usuario_email ,
                codigo_pais
            FROM resenas 
            WHERE producto_id = ?
            ORDER BY fecha_creacion DESC
            LIMIT ${limit} OFFSET ${offset}
        `;

        // Solo pasar el productoId como parámetro
        const [resenas] = await db.execute(queryResenas, [productoId]);

        console.log(`📊 Reseñas encontradas con paginación: ${resenas.length}`);

        // 3. Obtener total de reseñas (para paginación)
        const [totalResult] = await db.execute(
            'SELECT COUNT(*) as total FROM resenas WHERE producto_id = ?',
            [productoId]
        );
        const totalResenas = totalResult[0].total;
        console.log(`📊 Total de reseñas: ${totalResenas}`);

        // 4. Obtener estadísticas
        let estadisticas = {
            promedio_calificacion: 0,
            total_resenas: 0,
            distribucion_calificaciones: {
                1: 0, 2: 0, 3: 0, 4: 0, 5: 0
            }
        };

        if (totalResenas > 0) {
            const [statsResult] = await db.execute(`
                SELECT 
                    AVG(calificacion) as promedio_calificacion,
                    COUNT(*) as total_resenas
                FROM resenas 
                WHERE producto_id = ?
            `, [productoId]);

            const [distribucionResult] = await db.execute(`
                SELECT 
                    calificacion,
                    COUNT(*) as cantidad
                FROM resenas 
                WHERE producto_id = ? 
                GROUP BY calificacion
            `, [productoId]);

            estadisticas.promedio_calificacion = parseFloat(statsResult[0].promedio_calificacion) || 0;
            estadisticas.total_resenas = parseInt(statsResult[0].total_resenas) || 0;

            distribucionResult.forEach(item => {
                estadisticas.distribucion_calificaciones[item.calificacion] = item.cantidad;
            });

            console.log('✅ Estadísticas calculadas:', estadisticas);
        } else {
            console.log('ℹ️ No hay reseñas - usando estadísticas por defecto');
        }

        // 5. Calcular información de paginación
        const totalPages = Math.ceil(totalResenas / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        console.log(`📄 Paginación: Página ${page} de ${totalPages}`);

        // 6. Preparar respuesta
        const response = {
            success: true,
            data: {
                producto: {
                    id: productoCheck[0].id,
                    nombre: productoCheck[0].nombre
                },
                resenas: resenas,
                estadisticas: estadisticas,
                paginacion: {
                    currentPage: page,
                    totalPages: totalPages,
                    totalItems: totalResenas,
                    itemsPerPage: limit,
                    hasNextPage: hasNextPage,
                    hasPrevPage: hasPrevPage
                }
            }
        };

        console.log('✅ Respuesta preparada exitosamente');
        console.log('=== FIN ENDPOINT RESEÑAS ===');

        res.json(response);

    } catch (error) {
        console.error('❌ ERROR en endpoint reseñas:', error);
        console.error('Stack trace:', error.stack);
        console.log('=== FIN ENDPOINT RESEÑAS (CON ERROR) ===');

        res.status(500).json({
            success: false,
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno'
        });
    }
});
// CREAR NUEVA RESEÑA
app.post('/resenas', uploadResenas.single('imagen'), async (req, res) => {
    try {
        const {
            producto_id,
            usuario_nombre,
            usuario_email,
            pais,
            codigo_pais,
            calificacion,
            comentario
        } = req.body;

        // Validaciones básicas
        if (!producto_id || !usuario_nombre || !calificacion) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos obligatorios'
            });
        }

        if (calificacion < 1 || calificacion > 5) {
            return res.status(400).json({
                success: false,
                message: 'La calificación debe estar entre 1 y 5'
            });
        }

        // Verificar que el producto existe
        const [producto] = await db.execute('SELECT id FROM productos WHERE id = ?', [producto_id]);
        if (producto.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        const imagen_resena = req.file ? req.file.filename : null;

        const insertQuery = `
            INSERT INTO resenas (
                producto_id, usuario_nombre, usuario_email, pais, codigo_pais,
                calificacion, comentario
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        const [result] = await db.execute(insertQuery, [
            producto_id, usuario_nombre, usuario_email, pais, codigo_pais,
            calificacion, comentario
        ]);

        res.status(201).json({
            success: true,
            message: 'Reseña creada exitosamente',
            resena_id: result.insertId
        });

    } catch (error) {
        console.error('Error al crear reseña:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// OBTENER SOLO ESTADÍSTICAS DE RESEÑAS
app.get('/resenas-estadisticas/:productoId', async (req, res) => {
    try {
        const { productoId } = req.params;

        const query = `
            SELECT 
                total_resenas,
                promedio_calificacion,
                calificacion_5,
                calificacion_4,
                calificacion_3,
                calificacion_2,
                calificacion_1
            FROM resenas_estadisticas 
            WHERE producto_id = ?
        `;

        const [estadisticas] = await db.execute(query, [productoId]);

        const stats = estadisticas[0] || {
            total_resenas: 0,
            promedio_calificacion: 0,
            calificacion_5: 0,
            calificacion_4: 0,
            calificacion_3: 0,
            calificacion_2: 0,
            calificacion_1: 0
        };

        // Calcular porcentajes
        const total = stats.total_resenas || 1; // Evitar división por cero
        const porcentajes = {
            p5: Math.round((stats.calificacion_5 / total) * 100),
            p4: Math.round((stats.calificacion_4 / total) * 100),
            p3: Math.round((stats.calificacion_3 / total) * 100),
            p2: Math.round((stats.calificacion_2 / total) * 100),
            p1: Math.round((stats.calificacion_1 / total) * 100)
        };

        res.json({
            success: true,
            estadisticas: {
                ...stats,
                porcentajes
            }
        });

    } catch (error) {
        console.error('Error al obtener estadísticas:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// En el servidor - cambiar PUT por POST
app.post('/add-favoritos/:id_producto/:id_usuario', async (req, res) => {
    try {
        const id_producto = req.params.id_producto;
        const id_usuario = req.params.id_usuario;

        // Validar parámetros
        if (!id_producto || !id_usuario) {
            return res.status(400).json({
                success: false,
                message: 'Se requieren ID de producto y usuario'
            });
        }

        // Verificar si ya existe en favoritos
        const checkSql = 'SELECT * FROM favoritos WHERE id_producto = ? AND id_usuario = ?';
        const [existingFavs] = await db.execute(checkSql, [id_producto, id_usuario]);

        if (existingFavs && existingFavs.length > 0) {
            const sql = 'DELETE FROM favoritos WHERE id_producto = ? AND id_usuario = ?';
            const [result] = await db.execute(sql, [id_producto, id_usuario]);
            return res.status(200).json({
                success: true,
                message: 'Eliminado de Favoritos',
                alreadyExists: true
            });
        }

        // Insertar en favoritos
        const sql = 'INSERT INTO favoritos (id_producto, id_usuario) VALUES (?, ?)';
        const [result] = await db.execute(sql, [id_producto, id_usuario]);

        console.log("✅ Producto añadido a favoritos:", { id_producto, id_usuario });

        res.status(201).json({
            success: true,
            message: 'Producto añadido a favoritos',
            favorito_id: result.insertId
        });

    } catch (error) {
        console.error("❌ Error al añadir a favoritos:", error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'El producto ya está en favoritos'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error al añadir producto a favoritos',
            error: error.message
        });
    }
});

app.get('/favoritos/:id_usuario', async (req, res) => {
    const id_usuario = req.params.id_usuario;
    const query = 'Select p.id , p.nombre from productos p join favoritos f on p.id = f.id_producto join usuarios u on u.id = f.id_usuario where u.id = ?';

    try {
        const [resultado] = await db.execute(query, [id_usuario]);
        if (resultado.length > 0) {
            res.json({
                success: true,
                favoritos: resultado
            });
        } else {
            res.status(404).json({ success: false, message: 'Favoritos no Encontrados' });
        }
    } catch (error) {
        console.error('Error al obtener los Favoritos:', error);
        res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

app.get('/api/contacto-info/:id', async (req, res) => {
    const { id } = req.params;
    const sql = `
        SELECT 
            u.correo AS correoVendedor,
            p.nombre AS nombre
        FROM productos p
        JOIN usuarios u ON p.proveedor_id = u.id
        WHERE p.id = ?
    `;

    try {
        const [resultados] = await db.execute(sql, [id]);
        if (resultados.length > 0) {
            res.json({
                success: true,
                correoVendedor: resultados[0].correoVendedor,
                producto: resultados[0]
            });
        } else {
            res.status(404).json({ success: false, message: 'Producto no encontrado' });
        }
    } catch (err) {
        console.error('Error al obtener la info de contacto:', err);
        res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});




const nodemailer = require('nodemailer');
const { url } = require('inspector');

app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// Configura tu correo
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'rodriguezemelin20@gmail.com', // Cambia esto por tu correo de envío
        pass: 'dikm pznz ijwg ukii'     // Cambia esto por la clave de aplicación de Gmail
    }
});

app.post('/enviar-contacto', (req, res) => {
    console.log("BODY RECIBIDO:", req.body); // 👈 Esto es clave para ver si los datos llegan

    const { correoVendedor, buyerName, buyerEmail, buyerPhone, position, companyName, businessType, address, city, productName, productCategory, quantity, quantityUnit, deliveryLocation, expectedDeliveryDate, paymentTerms, urgency, specifications, additionalRequirements } = req.body;


    const mailOptions = {
        from: '"Plataforma B2B" <plataformab2b@gmail.com>',
        to: correoVendedor,
        subject: `Consulta sobre: ${productName}`,
        text: `
          Nombre del comprador: ${buyerName}
          Correo del comprador: ${buyerEmail}
          Teléfono: ${buyerPhone}
          Cargo/Posición: ${position}
          Nombre de la empresa: ${companyName}
          Tipo de negocio: ${businessType}

          Dirección: ${address}
          Ciudad: ${city}

          Producto de interés: ${productName}
          Categoría: ${productCategory}
          Cantidad requerida: ${quantity} ${quantityUnit}

          Lugar de entrega: ${deliveryLocation}
          Fecha esperada de entrega: ${expectedDeliveryDate}
          Términos de pago preferidos: ${paymentTerms}
          Urgencia de la cotización: ${urgency}

          Especificaciones técnicas: ${specifications}
          Requisitos adicionales: ${additionalRequirements}
        `
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error al enviar:', error);
            return res.status(500).send('Error al enviar el mensaje.');
        }
        res.redirect('/mensaje-exito.html');
    });
});

// Iniciar servidor
app.listen(puerto, () => {
    console.log(`🚀 Servidor escuchando en http://localhost:${puerto}`);
});