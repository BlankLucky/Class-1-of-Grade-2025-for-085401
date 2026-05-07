window.RED_MAP_CONFIG = {
  dataUrl: "data/sites.json",
  seedCheckinsUrl: "data/checkins.json",
  qrApiTemplate: "https://api.qrserver.com/v1/create-qr-code/?size=280x280&data={url}",
  deployment: {
    forceBaseUrl: ""
  },
  amap: {
    key: "",
    securityJsCode: "",
    city: "乌鲁木齐市",
    cityCode: "650100",
    mapStyle: "amap://styles/whitesmoke"
  },
  backend: {
    mode: "local-storage",
    supabase: {
      url: "",
      anonKey: "",
      table: "activity_checkins"
    },
    localApi: {
      baseUrl: ""
    }
  }
};
