require([ 'Cesium', './src/locations.js' ], function(Cesium, locations) {

  "use strict";

  var lofi = false;
  var postprocess = true;

  var canvasL = document.createElement('canvas');
  canvasL.className = "fullSize";
  document.getElementById('cesiumContainerLeft').appendChild(canvasL);

  var canvasR = document.createElement('canvas');
  canvasR.className = "fullSize";
  document.getElementById('cesiumContainerRight').appendChild(canvasR);
  var contextR = canvasR.getContext('2d');

  var ellipsoid = Cesium.Ellipsoid.WGS84;
  var imageryUrl = 'lib/cesium/Source/Assets/Textures/';

  function createImageryProvider() {
    if (lofi) {
      return new Cesium.TileMapServiceImageryProvider({
        url : imageryUrl + 'NaturalEarthII'
      });
    } else {
      return new Cesium.BingMapsImageryProvider({
        url : '//dev.virtualearth.net',
        mapStyle : Cesium.BingMapsStyle.AERIAL
      // mapStyle : Cesium.BingMapsStyle.AERIAL_WITH_LABELS
      });
    }
  }

  function createTerrainProvider() {
    if (lofi) {
      return new Cesium.EllipsoidTerrainProvider();
    } else {
      return new Cesium.CesiumTerrainProvider({
        url : '//cesiumjs.org/stk-terrain/tilesets/world/tiles'
      });
    }
  }

  function getParams(hmd, eye) {
    var result = {};

    result.postProcessFilter = new Cesium.CustomPostProcess(RiftIO.getShader(), RiftIO.getUniforms(hmd, eye));

    // Calculate offset as per Oculus SDK docs
    var viewCenter = hmd.screenSizeHorz * 0.25;
    var eyeProjectionShift = viewCenter - hmd.lensSeparationDistance * 0.5;
    var projectionCenterOffset = 4.0 * eyeProjectionShift / hmd.screenSizeHorz;
    projectionCenterOffset *= 0.5;
    result.frustumOffset = eye === 'left' ? -projectionCenterOffset : projectionCenterOffset;

    return result;
  }

  function createScene(canvas, hmd) {
    var scene = new Cesium.Scene(canvas);
    var primitives = scene.primitives;

    scene.camera.frustum.fovy = Cesium.Math.toRadians(90.0);

    var cb = new Cesium.Globe(ellipsoid);
    cb.imageryLayers.addImageryProvider(createImageryProvider());
    cb.terrainProvider = createTerrainProvider();

    scene.globe = cb;

    // Prevent right-click from opening a context menu.
    canvas.oncontextmenu = function() {
      return false;
    };

    scene.skyAtmosphere = new Cesium.SkyAtmosphere();

    var skyBoxBaseUrl = imageryUrl + 'SkyBox/tycho2t3_80';
    scene.skyBox = new Cesium.SkyBox({
      positiveX : skyBoxBaseUrl + '_px.jpg',
      negativeX : skyBoxBaseUrl + '_mx.jpg',
      positiveY : skyBoxBaseUrl + '_py.jpg',
      negativeY : skyBoxBaseUrl + '_my.jpg',
      positiveZ : skyBoxBaseUrl + '_pz.jpg',
      negativeZ : skyBoxBaseUrl + '_mz.jpg'
    });

    return scene;
  }

  var slaveCameraUpdate = function(master, slave, eyeOffset) {
    var eye = new Cesium.Cartesian3();
    var target = new Cesium.Cartesian3();
    var up = new Cesium.Cartesian3();
    var right = new Cesium.Cartesian3();

    Cesium.Cartesian3.clone(master.position, eye);
    Cesium.Cartesian3.clone(master.direction, target);
    Cesium.Cartesian3.clone(master.up, up);

    var eyeCart = new Cesium.Cartographic();
    ellipsoid.cartesianToCartographic(eye, eyeCart);

    Cesium.Cartesian3.cross(master.direction, master.up, right);

    Cesium.Cartesian3.multiplyByScalar(right, eyeOffset, right);
    Cesium.Cartesian3.add(eye, right, eye);

    Cesium.Cartesian3.multiplyByScalar(target, 10000, target);
    Cesium.Cartesian3.add(target, eye, target);

    slave.lookAt(eye, target, up);
  };

  var io = new RiftIO(Cesium, run);

  function run(hmd) {
    var params = {
      "left" : getParams(hmd, "left"),
      "right" : getParams(hmd, "right")
    };

    var scene = createScene(canvasL, hmd);

    var ellipsoid = Cesium.Ellipsoid.clone(Cesium.Ellipsoid.WGS84);

    var getCameraParams = function(camera) {
      return {
        "position" : camera.position,
        "right" : camera.right,
        "up" : camera.up,
        "direction" : camera.direction
      };
    };

    var setCameraParams = function(_, camera) {
      camera.position = _.position;
      camera.right = _.right;
      camera.up = _.up;
      camera.direction = _.direction;
      firstTime = true;
    };

    var levelTheCamera = function(camera) {
      Cesium.Cartesian3.normalize(camera.position, camera.up);
      Cartesian3.cross(camera.direction, camera.up, camera.right);
      // Cartesian3.cross(camera.up, camera.right, camera.direction);
      firstTime = true;
    }

    var getCameraRotationMatrix = function(camera) {
      var result = new Cesium.Matrix3();
      Cesium.Matrix3.setRow(result, 0, camera.right, result);
      Cesium.Matrix3.setRow(result, 1, camera.up, result);
      Cesium.Matrix3.setRow(result, 2, Cesium.Cartesian3.negate(camera.direction), result);
      return result;
    };

    var setCameraRotationMatrix = function(rotation, camera) {
      camera.right = Cesium.Matrix3.getRow(rotation, 0);
      camera.up = Cesium.Matrix3.getRow(rotation, 1);
      camera.direction = Cesium.Cartesian3.negate(Cesium.Matrix3.getRow(rotation, 2));
    };

    var cameraMatrix = new Cesium.Matrix3();
    var refMtx = new Cesium.Matrix3();
    var firstTime = true;

    var applyOculusRotation = function(camera, rotation) {
      var oculusRotationMatrix = Cesium.Matrix3.fromQuaternion(Cesium.Quaternion.inverse(rotation));
      var sceneCameraMatrix = getCameraRotationMatrix(camera);
      if (firstTime) {
        Cesium.Matrix3.inverse(oculusRotationMatrix, refMtx);
        Cesium.Matrix3.multiply(refMtx, sceneCameraMatrix, refMtx);
      } else {
        var cameraDelta = Cesium.Matrix3.multiply(Cesium.Matrix3.inverse(cameraMatrix), sceneCameraMatrix);
        Cesium.Matrix3.multiply(refMtx, cameraDelta, refMtx);
      }
      Cesium.Matrix3.multiply(oculusRotationMatrix, refMtx, cameraMatrix);
      setCameraRotationMatrix(cameraMatrix, camera);
      firstTime = false;
    }

    function setSceneParams(scene, params) {
      if (postprocess) {
        scene.customPostProcess = params.postProcessFilter;
      }
      scene.camera.frustum.setOffset(params.frustumOffset, 0.0);
    }

    var tick = function() {
      applyOculusRotation(scene.camera, io.getRotation());

      var eyeSeparation = 1.0;

      // Render right eye
      setSceneParams(scene, params['right']);
      scene.initializeFrame();
      scene.render();
      contextR.drawImage(canvasL, 0, 0); // Copy to right eye canvas

      // Render left eye
      var originalCamera = scene.camera.clone()
      slaveCameraUpdate(originalCamera, scene.camera, -eyeSeparation);
      setSceneParams(scene, params['left']);
      scene.initializeFrame();
      scene.render();

      slaveCameraUpdate(originalCamera, scene.camera, 0.0);
      Cesium.requestAnimationFrame(tick);
    }

    tick();

    // Resize handler
    var onResizeScene = function(canvas, scene) {
      var riftAspect = 1.0; // should be 0.8
      var width = canvas.clientWidth;
      var height = canvas.clientHeight;

      if (canvas.width === width && canvas.height === height) {
        return;
      }

      canvas.width = width;
      canvas.height = height;
      scene.camera.frustum.aspectRatio = width / height * riftAspect;
    };

    var onResize = function() {
      onResizeScene(canvasL, scene);
      onResizeScene(canvasR, scene);
    };

    var moveForward = function(camera, amount) {
      Cesium.Cartesian3.add(camera.position, Cesium.Cartesian3.multiplyByScalar(camera.direction, amount), camera.position);
    }

    var onKeyDown = function(e) {
      // alert(JSON.stringify(e.keyCode));
      if (e.keyCode === 38) {
        moveForward(scene.camera, 10.0);
        e.preventDefault();
      }
      if (e.keyCode === 40) {
        moveForward(scene.camera, -10.0);
        e.preventDefault();
      }
      if (e.keyCode === 73)
        alert(JSON.stringify(getCameraParams(scene.camera)));
      if (e.keyCode === 76)
        levelTheCamera(scene.camera);
      if (typeof locations[e.keyCode] !== 'undefined') {
        setCameraParams(locations[e.keyCode], scene.camera);
      }
    }

    window.addEventListener('resize', onResize, false);
    window.addEventListener('keydown', onKeyDown, false);
    window.setTimeout(onResize, 60);
  }

});
