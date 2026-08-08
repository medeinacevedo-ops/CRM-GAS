const socketIo = require("socket.io");

let io;

module.exports = {
  init: (server) => {
    io = socketIo(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
      },
      allowEIO3: true // Compatibilidad
    });

    io.on("connection", (socket) => {
      console.log(`[Socket] Cliente conectado: ${socket.id}`);

      // Permitir que el cliente se una a una sala con su user_id
      socket.on("join", (userId) => {
        if (userId) {
          socket.join(`user_${userId}`);
          console.log(`[Socket] Usuario ${userId} se unió a su sala privada`);
        }
      });

      // Sala compartida para el mapa de seguimiento en vivo (admin/supervisor).
      // Se une explicitamente al abrir esa pantalla, para no recibir
      // heartbeats de todos los vendedores en clientes que no la usan.
      socket.on("join_monitoreo", () => {
        socket.join("monitoreo_ubicacion");
      });

      socket.on("leave_monitoreo", () => {
        socket.leave("monitoreo_ubicacion");
      });

      socket.on("disconnect", (reason) => {
        console.log(`[Socket] Cliente desconectado: ${socket.id}. Motivo: ${reason}`);
      });
    });

    return io;
  },
  getIo: () => {
    if (!io) {
      throw new Error("Socket.io no ha sido inicializado");
    }
    return io;
  }
};
