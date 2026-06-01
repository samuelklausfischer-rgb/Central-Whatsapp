migrate(
  (app) => {
    const devicesCol = app.findCollectionByNameOrId('devices')

    let prnDevice
    try {
      prnDevice = app.findFirstRecordByData('devices', 'instance_key', 'PRN')
    } catch (_) {
      prnDevice = null
    }

    if (!prnDevice) {
      prnDevice = new Record(devicesCol)
      prnDevice.set('name', 'PRN')
      prnDevice.set('instance_key', 'PRN')
      prnDevice.set('status', 'open')
      app.save(prnDevice)
      console.log('Created device PRN with instance_key=PRN')
    } else {
      if (prnDevice.getString('status') !== 'open') {
        prnDevice.set('status', 'open')
        app.save(prnDevice)
        console.log('Updated PRN device status to open')
      }
    }

    let celularTeste
    try {
      celularTeste = app.findFirstRecordByData('devices', 'instance_key', 'Celular teste')
    } catch (_) {
      celularTeste = null
    }

    if (!celularTeste) {
      celularTeste = new Record(devicesCol)
      celularTeste.set('name', 'Celular teste')
      celularTeste.set('instance_key', 'Celular teste')
      celularTeste.set('status', 'open')
      app.save(celularTeste)
      console.log('Created device Celular teste with instance_key=Celular teste')
    } else {
      if (celularTeste.getString('status') !== 'open') {
        celularTeste.set('status', 'open')
        app.save(celularTeste)
        console.log('Updated Celular teste device status to open')
      }
    }

    try {
      const samuel = app.findAuthRecordByEmail('_pb_users_auth_', 'samuelklausfischer@hotmail.com')
      samuel.set('is_admin', true)
      app.save(samuel)
      console.log('Ensured Samuel is admin')
    } catch (_) {
      try {
        const samuel = app.findFirstRecordByData('_pb_users_auth_', 'username', 'Samuel')
        samuel.set('is_admin', true)
        app.save(samuel)
        console.log('Ensured Samuel (by username) is admin')
      } catch (__) {
        console.log('Could not find Samuel user to set admin')
      }
    }
  },
  (app) => {
  },
)
